import { PANEL_ROOTS, isReservedSlug, toAuthArea } from "@/lib/shopPaths"

export type AuthView = "entrar" | "criar-conta" | "recuperar"

const AUTH_VIEWS: AuthView[] = ["entrar", "criar-conta", "recuperar"]

export function toAuthView(value: string | null): AuthView | null {
  return AUTH_VIEWS.find((view) => view === value) ?? null
}

/** Estado enviado à Landing Page quando uma rota protegida pede login. */
export type AuthRedirectState = {
  from?: string
  sessionRejected?: boolean
} | null

const DEFAULT_NEXT = "/dashboard"
const NEXT_KEY = "barberia:auth-next"

/** Endereço de barbearia na raiz: /slug ou /slug/minhas-reservas (nunca uma palavra reservada do sistema). */
const SHOP_PATH = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/(?:minhas-reservas|servicos|profissionais|galeria|contato))?(?:[?#]|$)/

/** Destinos do sistema aceitos depois do login: o Início, as telas do painel na raiz, a área do cliente e o convite. */
const KNOWN_NEXT = new RegExp(`^/(?:dashboard|${PANEL_ROOTS.join("|")}|minhas-reservas|convite|e/[a-z0-9-]+)(?:[/?#]|$)`)

/** Porta do sistema (dono e equipe): /painel/entrar, /painel/criar-conta, /painel/recuperar. */
export const panelAuthPath = (view: AuthView = "entrar"): string => `/painel/${view}`

/** Porta certa para um destino: página de barbearia → porta do cliente dela (/slug/entrar); o resto → porta do sistema. */
export function authDoor(next: string, view: AuthView = "entrar"): string {
  const shop = SHOP_PATH.exec(next)
  return shop && !isReservedSlug(shop[1]) ? `/${shop[1]}/${view}` : panelAuthPath(view)
}

/** Aceita apenas destinos conhecidos (área protegida e páginas das barbearias), o que impede redirecionamento para outro site. */
export function safeNext(path: unknown): string {
  if (typeof path !== "string") return DEFAULT_NEXT
  const shop = SHOP_PATH.exec(path)
  const known = KNOWN_NEXT.test(path) || Boolean(shop && !isReservedSlug(shop[1]))
  if (!known) return DEFAULT_NEXT
  if (path.includes("..") || path.includes("\\")) return DEFAULT_NEXT
  return path
}

const NEXT_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Guarda o destino no navegador porque o OAuth e o e-mail saem da aplicação antes de voltar. Fica no localStorage
 * (o link de confirmação do e-mail abre em outra aba, que não enxerga o sessionStorage) e vence em 24 h.
 */
export function rememberNext(path: unknown) {
  try {
    localStorage.setItem(NEXT_KEY, JSON.stringify({ path: safeNext(path), exp: Date.now() + NEXT_TTL_MS }))
  } catch {
    // navegador sem armazenamento: o retorno usa o destino da conta ou o painel
  }
}

/**
 * Destino guardado, uma única vez. Sem ele (outro aparelho ou navegador), usa `fallback` — a barbearia onde a conta
 * foi criada — e, por fim, o painel. Tudo passa por `safeNext`.
 */
export function consumeNext(fallback?: unknown): string {
  const stored = peekNext()
  try { localStorage.removeItem(NEXT_KEY) } catch { /* armazenamento indisponível */ }
  return safeNext(stored ?? fallback)
}

/** Destino guardado (sem consumir), ou null se não houver ou tiver vencido. */
export function peekNext(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(NEXT_KEY) ?? "null") as { path?: unknown; exp?: unknown } | null
    if (saved && typeof saved.exp === "number" && saved.exp > Date.now() && typeof saved.path === "string") return saved.path
  } catch {
    // valor adulterado ou armazenamento indisponível
  }
  return null
}

export const MIN_PASSWORD_LENGTH = 8

type Errors = Record<string, string>

function emailError(email: string): string | null {
  const value = email.trim()
  if (!value) return "Informe seu email."
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : "Informe um email válido."
}

function collect(entries: Record<string, string | null>): Errors {
  return Object.fromEntries(Object.entries(entries).filter(([, message]) => message)) as Errors
}

function newPasswordErrors({ senha, confirmacao }: { senha: string; confirmacao: string }) {
  return {
    senha: senha.length < MIN_PASSWORD_LENGTH ? `Use pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` : null,
    confirmacao: !confirmacao ? "Confirme sua senha." : confirmacao !== senha ? "As senhas não são iguais." : null,
  }
}

export function validateLogin({ email, senha }: { email: string; senha: string }): Errors {
  return collect({ email: emailError(email), senha: senha ? null : "Informe sua senha." })
}

export function validateSignUp(values: { nome: string; email: string; senha: string; confirmacao: string }): Errors {
  return collect({
    nome: values.nome.trim() ? null : "Informe seu nome.",
    email: emailError(values.email),
    ...newPasswordErrors(values),
  })
}

export function validateRecover({ email }: { email: string }): Errors {
  return collect({ email: emailError(email) })
}

export function validateNewPassword(values: { senha: string; confirmacao: string }): Errors {
  return collect(newPasswordErrors(values))
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "Email ou senha incorretos.",
  email_not_confirmed: "Confirme seu email antes de entrar. Procure o link na sua caixa de entrada.",
  user_already_exists: "Não foi possível criar a conta com este email. Se ele já é seu, entre ou recupere a senha.",
  email_exists: "Não foi possível criar a conta com este email. Se ele já é seu, entre ou recupere a senha.",
  weak_password: "Esta senha é fraca. Use uma senha maior, misturando letras e números.",
  same_password: "A nova senha precisa ser diferente da anterior.",
  signup_disabled: "O cadastro está desativado no momento.",
  email_provider_disabled: "O acesso com email e senha está desativado no momento.",
  provider_disabled: "O acesso com Google está desativado no momento.",
  email_address_invalid: "Este email não é aceito. Use outro endereço.",
  over_email_send_rate_limit: "Muitos emails enviados em pouco tempo. Aguarde alguns minutos e tente de novo.",
  over_request_rate_limit: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.",
  session_expired: "Sua sessão expirou. Peça um novo link.",
  session_not_found: "Sua sessão expirou. Peça um novo link.",
}

/** Mensagem para o usuário, sem repassar detalhes internos do servidor (Segurança.md). */
export function authErrorMessage(error: unknown): string {
  const { code, name, status } = (error ?? {}) as { code?: string; name?: string; status?: number }
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]
  // A SDK marca todo HTTP 5xx como "retryable": é falha do servidor (ex.: envio de e-mail recusado), não da internet da pessoa
  if (typeof status === "number" && status >= 500) return "O servidor não conseguiu concluir agora. Tente de novo em alguns minutos."
  if (name === "AuthRetryableFetchError" || status === 0 || error instanceof TypeError) {
    return "Sem conexão com o servidor. Verifique sua internet e tente de novo."
  }
  return "Não foi possível concluir. Tente novamente."
}

export type CallbackError = "link-expirado" | "falha" | "confirmado" | "outro-navegador"

export const CALLBACK_NOTICES: Record<CallbackError, string> = {
  "link-expirado": "Este link expirou ou já foi usado. Entre com e-mail e senha ou peça um novo em “Esqueci minha senha”.",
  falha: "Não foi possível concluir a autenticação. Tente novamente.",
  // E-mails enviados antes do modelo com token_hash: o código PKCE só conclui no navegador em que o fluxo começou
  confirmado: "E-mail confirmado. Agora entre com seu e-mail e senha.",
  "outro-navegador": "Abra o link no mesmo navegador em que pediu a nova senha, ou peça um novo link aqui.",
}

export const SESSION_REJECTED_NOTICE = "Sua sessão expirou. Entre novamente."

export function parseAuthCallback(hash: string, search: string) {
  const params = new URLSearchParams(search)
  new URLSearchParams(hash.replace(/^#/, "")).forEach((value, key) => params.set(key, value))

  // Tokens do fluxo implícito no link são recusados (o app só inicia PKCE): tratados como falha, sem trocar a sessão.
  const implicit = params.has("access_token") || params.has("refresh_token")
  const hasError = params.has("error") || params.has("error_code") || implicit
  const error: CallbackError | null = !hasError ? null : params.get("error_code") === "otp_expired" ? "link-expirado" : "falha"

  return {
    error,
    isRecovery: params.get("type") === "recovery" || params.get("tipo") === "recuperar",
    hasAuthParams: hasError || params.has("code") || params.has("token_hash"),
    /** Área que iniciou o fluxo (colocada no link por `callbackUrl`); links antigos não têm. */
    area: toAuthArea(params.get("area")),
    tipo: params.get("tipo"),
    code: params.get("code"),
    /** Link do e-mail (modelo com `{{ .TokenHash }}`): conclui em qualquer navegador. */
    tokenHash: params.get("token_hash"),
    /** Porta de origem gravada no link (`callbackUrl`); validada pela área no /auth/callback. */
    volta: params.get("volta"),
  }
}
