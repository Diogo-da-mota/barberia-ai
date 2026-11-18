import { authClients, CALLBACK_PATH, currentArea, detachedAuth, supabase } from "@/lib/supabase"
import type { AuthArea } from "@/lib/shopPaths"
import type { Session, User } from "@supabase/supabase-js"
import { rememberAuthEmail, rememberNext, requestedAuthEmail, safeNext } from "../domain"

/**
 * Usa a origem atual (qualquer porta ou domínio cadastrado no Supabase). `area` diz ao /auth/callback qual sessão o fluxo
 * atualiza; `volta` é a porta de origem (barbearia ou painel), para o link do e-mail aberto em outro aparelho voltar a ela.
 * Os modelos de e-mail (supabase/email-templates) acrescentam `#token_hash=…&type=…` a este endereço (`{{ .RedirectTo }}`):
 * depois do `#`, o token não chega a servidor nem a log.
 */
/** Destino que pode sair do navegador (link do e-mail, metadados da conta): sem o token do convite, que fica só no destino guardado aqui. */
const shareableNext = (next: string) => safeNext(next).replace(/^\/convite\?.*$/, "/convite")

function callbackUrl(tipo?: "cadastro" | "recuperar", next?: string) {
  const volta = next ? `&volta=${encodeURIComponent(shareableNext(next))}` : ""
  return `${window.location.origin}${CALLBACK_PATH}?area=${currentArea()}${tipo ? `&tipo=${tipo}` : ""}${volta}`
}

/** O fluxo começa no cliente da área aberta (porta do painel ou da barbearia): o verificador PKCE fica só nele. */
export async function signInWithGoogle(next = "/dashboard") {
  rememberNext(next)
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl(),
      // convite da equipe: o Google sempre pergunta qual conta usar (sem entrar sozinho com a conta já aberta no navegador).
      // Não impede criar conta com outro e-mail (o Supabase cria antes de voltar); quem barra é o aceite no servidor (0035).
      ...(next.startsWith("/convite") ? { queryParams: { prompt: "select_account" } } : {}),
    },
  })
  if (error) {
    throw error
  }
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    throw error
  }
}

/** `full_name` é só para exibição: papéis e permissões nunca vêm de `user_metadata`. */
export async function signUp(account: { nome: string; email: string; senha: string; whatsapp?: string }, next = "/dashboard") {
  rememberNext(next)
  rememberAuthEmail(account.email)
  const { data, error } = await supabase.auth.signUp({
    email: account.email,
    password: account.senha,
    options: {
      emailRedirectTo: callbackUrl("cadastro", next),
      // signup_next: destino ao confirmar o e-mail em outro aparelho (só navegação, validada por safeNext)
      // whatsapp: o banco copia para profiles.whatsapp ao criar a conta (só dígitos válidos)
      data: { full_name: account.nome, signup_next: shareableNext(next), ...(account.whatsapp ? { whatsapp: account.whatsapp } : {}) },
    },
  })
  if (error) {
    throw error
  }
  // E-mail já cadastrado: com a confirmação de e-mail ligada o Supabase não devolve erro, e sim um usuário sem identidades
  // (e não envia e-mail). A tela orienta a entrar ou recuperar a senha em vez de esperar uma confirmação que não vem.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { needsEmailConfirmation: false, alreadyRegistered: true }
  }
  return { needsEmailConfirmation: !data.session }
}

/**
 * Exclui a própria conta (LGPD, migration 0056): apaga o login e tira nome, WhatsApp e e-mail das reservas antigas.
 * O banco recusa dono de barbearia ('owner_cannot_delete') e quem tem reserva futura ('has_upcoming_bookings').
 */
export async function deleteMyAccount() {
  const { error } = await supabase.rpc("delete_my_account")
  if (error) {
    throw error
  }
}

/** `next`: para onde voltar depois de salvar a nova senha (cliente → barbearia; equipe → painel), em qualquer navegador. */
export async function requestPasswordReset(email: string, next = "/dashboard") {
  rememberNext(next)
  rememberAuthEmail(email)
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl("recuperar", next) })
  if (error) {
    throw error
  }
}

export async function updatePassword(password: string, area: AuthArea = currentArea()) {
  const { error } = await authClients[area].auth.updateUser({ password })
  if (error) {
    throw error
  }
}

/** `local`: encerra só a sessão desta área neste navegador; a outra área (mesmo que seja a mesma pessoa) continua logada. */
export async function signOut(scope: "global" | "local" = "local", area: AuthArea = currentArea()) {
  const { error } = await authClients[area].auth.signOut({ scope })
  if (error) {
    throw error
  }
}

export async function getSession(area: AuthArea = currentArea()) {
  const { data, error } = await authClients[area].auth.getSession()
  if (error) {
    throw error
  }
  return data.session
}

export type AuthStateChange = {
  event: string
  session: Session | null
  user: User | null
}

export function onAuthStateChange(
  callback: (state: AuthStateChange) => void,
  area: AuthArea = currentArea()
) {
  const { data } = authClients[area].auth.onAuthStateChange((event, session) => {
    callback({ event, session, user: session?.user ?? null })
  })
  return data
}

/**
 * Link de e-mail de OUTRA conta (com sessão nesta área) ou de conta que este navegador não pediu (sem sessão, `atual: null`):
 * a sessão só muda se a pessoa confirmar a conta do link (AuthCallback).
 */
export type AccountSwitch = { atual: string | null; link: string; confirmar: () => Promise<void>; cancelar: () => Promise<void> }

const finishing = new Map<string, Promise<{ recovery: boolean; troca?: AccountSwitch }>>()

type CallbackInput = {
  code: string | null
  tokenHash?: string | null
  isRecovery?: boolean
}

/**
 * Conclui o retorno do Google ou do e-mail SÓ no cliente da área que iniciou o fluxo, uma vez por link (o StrictMode e um
 * segundo render não concluem duas vezes). `tokenHash`: link do e-mail (cadastro e nova senha), vale em qualquer navegador
 * ou aparelho; o servidor aceita cada link uma única vez e só até expirar. `code`: Google (PKCE, o verificador está só no
 * cliente desta área, no navegador que iniciou) e e-mails antigos. Tokens do fluxo implícito (`#access_token=`) nunca são
 * aceitos: o app só inicia PKCE, e um link com os tokens de outra conta trocaria a sessão desta área sem ninguém perceber.
 * Pelo mesmo motivo, `tokenHash` é sempre conferido num cliente à parte e só entra direto quando é da conta já aberta na área
 * ou, sem sessão, do e-mail que este navegador pediu (cadastro ou nova senha). Nos outros casos devolve `troca` e a sessão só
 * muda se a pessoa confirmar a conta do link: um link da conta de outra pessoa não faz login escondido (login CSRF).
 */
export function finishAuthCallback(area: AuthArea, input: CallbackInput) {
  const key = `${area}:${input.tokenHash ?? input.code ?? ""}`
  let pending = finishing.get(key)
  if (!pending) {
    pending = (async () => {
      const auth = authClients[area].auth
      if (input.tokenHash) {
        const type = input.isRecovery ? "recovery" : "email"
        const atual = (await auth.getSession()).data.session
        const conferencia = detachedAuth()
        const { data, error } = await conferencia.verifyOtp({ token_hash: input.tokenHash, type })
        if (error) throw error
        const nova = data.session
        if (!nova) throw new Error("Retorno sem sessão")
        const confirmar = async () => {
          const { error: falha } = await auth.setSession({ access_token: nova.access_token, refresh_token: nova.refresh_token })
          if (falha) throw falha
        }
        const pedida = requestedAuthEmail()
        const mesmaConta = atual ? nova.user.id === atual.user.id : Boolean(pedida && nova.user.email?.toLowerCase() === pedida)
        if (mesmaConta) {
          await confirmar()
          return { recovery: type === "recovery" }
        }
        const cancelar = async () => { await conferencia.signOut({ scope: "local" }) }
        const troca = { atual: atual ? atual.user.email ?? "sua conta atual" : null, link: nova.user.email ?? "outra conta", confirmar, cancelar }
        return { recovery: type === "recovery", troca }
      }
      if (input.code) {
        const { data, error } = await auth.exchangeCodeForSession(input.code)
        if (error) throw error
        // a SDK devolve `redirectType` ("recovery" no link de nova senha), ainda fora do tipo publicado
        return { recovery: (data as { redirectType?: string | null }).redirectType === "recovery" }
      }
      throw new Error("Retorno sem código")
    })()
    finishing.set(key, pending)
  }
  return pending
}

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser()
  if (error) {
    throw error
  }
  return data.user
}

/** Guarda a cor de destaque na conta (vale em qualquer aparelho). É só aparência: nunca define permissões. */
export async function saveAccentPreference(choice: string) {
  const { error } = await supabase.auth.updateUser({ data: { accent: choice } })
  if (error) {
    throw error
  }
}
