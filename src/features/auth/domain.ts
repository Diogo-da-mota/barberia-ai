import { isReservedSlug } from "@/lib/shopPaths"

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

/** Aceita apenas destinos conhecidos (área protegida e páginas das barbearias), o que impede redirecionamento para outro site. */
export function safeNext(path: unknown): string {
  if (typeof path !== "string") return DEFAULT_NEXT
  const shop = SHOP_PATH.exec(path)
  const known = /^\/(?:dashboard|minhas-reservas|convite|e\/[a-z0-9-]+)(?:[/?#]|$)/.test(path) || Boolean(shop && !isReservedSlug(shop[1]))
  if (!known) return DEFAULT_NEXT
  if (path.includes("..") || path.includes("\\")) return DEFAULT_NEXT
  return path
}

/** Guarda o destino no navegador porque o OAuth e o email saem da aplicação antes de voltar. */
export function rememberNext(path: unknown) {
  sessionStorage.setItem(NEXT_KEY, safeNext(path))
}

export function consumeNext(): string {
  const next = safeNext(sessionStorage.getItem(NEXT_KEY))
  sessionStorage.removeItem(NEXT_KEY)
  return next
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
  if (name === "AuthRetryableFetchError" || status === 0 || error instanceof TypeError) {
    return "Sem conexão com o servidor. Verifique sua internet e tente de novo."
  }
  return "Não foi possível concluir. Tente novamente."
}

export type CallbackError = "link-expirado" | "falha"

export const CALLBACK_NOTICES: Record<CallbackError, string> = {
  "link-expirado": "Este link expirou ou já foi usado. Peça um novo.",
  falha: "Não foi possível concluir a autenticação. Tente novamente.",
}

export const SESSION_REJECTED_NOTICE = "Sua sessão expirou. Entre novamente."

export function parseAuthCallback(hash: string, search: string) {
  const params = new URLSearchParams(search)
  new URLSearchParams(hash.replace(/^#/, "")).forEach((value, key) => params.set(key, value))

  const hasError = params.has("error") || params.has("error_code")
  const error: CallbackError | null = !hasError ? null : params.get("error_code") === "otp_expired" ? "link-expirado" : "falha"

  return {
    error,
    isRecovery: params.get("type") === "recovery",
    hasAuthParams: hasError || params.has("access_token") || params.has("code"),
  }
}
