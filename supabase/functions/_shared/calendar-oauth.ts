/**
 * Vínculo do Google Agenda por profissional (função google-calendar-oauth). Lógica pura: ambiente, banco (service_role), sessão e
 * rede chegam de fora, para rodar igual no Deno e nos testes.
 *   GET ?state=&code_challenge=  → leva ao consentimento do Google (escopo calendar.events). O verificador PKCE fica no app,
 *                                   no navegador de quem iniciou (sessionStorage); aqui não há cookie.
 *   GET ?code=&state=            → retorno do Google: NÃO troca o código; devolve ao app (…/mais?calendario=retorno#…).
 *   POST { code, state, code_verifier } com a sessão do painel → confere que o state pertence ao profissional da própria
 *                                   conta (calendar_state_owner, migration 0047), troca o código e conclui o vínculo.
 * Um link de início aberto por outra pessoa nunca conclui: o código do Google chega ao navegador dela, sem o verificador de
 * quem iniciou, e a conta dela não é a dona do state.
 */
import { corsHeaders } from "./cors.ts"

export const GCAL_SCOPE = "https://www.googleapis.com/auth/calendar.events"

export type CalendarOAuthDeps = {
  env: (name: string) => string | undefined
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  /** Id da conta dona do JWT do painel, ou null se inválido. */
  userId: (jwt: string) => Promise<string | null>
  professionalOf: (connectionId: string) => Promise<string | null>
  fetch: typeof fetch
}

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/

export async function handleCalendarOAuth(req: Request, deps: CalendarOAuthDeps): Promise<Response> {
  const url = new URL(req.url)
  const app = deps.env("APP_URL") ?? ""
  const redirectUri = `${deps.env("SUPABASE_URL")}/functions/v1/google-calendar-oauth`
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })
  const back = (status: string, hash = "") => new Response(null, { status: 302, headers: { Location: `${app}/mais?calendario=${status}${hash}` } })

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  if (req.method === "POST") {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
    const user = jwt ? await deps.userId(jwt) : null
    if (!user) return json({ error: "not_authenticated" }, 401)
    const body = (await req.json().catch(() => null)) as { code?: unknown; state?: unknown; code_verifier?: unknown } | null
    const code = typeof body?.code === "string" ? body.code : ""
    const state = typeof body?.state === "string" ? body.state : ""
    const verifier = typeof body?.code_verifier === "string" ? body.code_verifier : ""
    if (!code || !state || !VERIFIER.test(verifier)) return json({ error: "invalid_request" }, 400)

    const dono = await deps.rpc("calendar_state_owner", { p_state: state })
    if (dono.error || dono.data !== user) return json({ error: "forbidden" }, 403)

    const token = await deps.fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: deps.env("GOOGLE_CLIENT_ID") ?? "", client_secret: deps.env("GOOGLE_CLIENT_SECRET") ?? "",
        redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!token.ok) return json({ error: "erro" }, 400)
    const tokens = (await token.json()) as { refresh_token?: string; scope?: string }
    if (!tokens.refresh_token) return json({ error: "erro" }, 400)

    const fim = await deps.rpc("complete_calendar_link", {
      p_state: state, p_calendar_id: "primary", p_escopos: (tokens.scope ?? "").split(" ").filter(Boolean),
    })
    if (fim.error) return json({ error: fim.error.message.includes("scope") ? "escopo" : "erro" }, 400)
    const professional = await deps.professionalOf(String(fim.data))
    if (!professional) return json({ error: "erro" }, 400)
    const salvo = await deps.rpc("store_calendar_tokens", { p_professional_id: professional, p_refresh_token: tokens.refresh_token })
    if (salvo.error) return json({ error: "erro" }, 500)
    return json({ ok: true })
  }

  if (req.method !== "GET") return new Response("method not allowed", { status: 405 })
  // Recusa no Google (ex.: access_denied): volta ao painel em vez de reabrir o consentimento
  if (url.searchParams.has("error")) return back("erro")
  const state = url.searchParams.get("state") ?? ""
  const code = url.searchParams.get("code")

  if (!code) {
    const challenge = url.searchParams.get("code_challenge") ?? ""
    if (!state || !CHALLENGE.test(challenge)) return new Response("bad request", { status: 400 })
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth")
    auth.search = new URLSearchParams({
      client_id: deps.env("GOOGLE_CLIENT_ID") ?? "", redirect_uri: redirectUri, response_type: "code", scope: GCAL_SCOPE,
      access_type: "offline", prompt: "consent", state, include_granted_scopes: "false",
      code_challenge: challenge, code_challenge_method: "S256",
    }).toString()
    return new Response(null, { status: 302, headers: { Location: auth.toString() } })
  }

  // Retorno do Google: o código segue no fragmento (não vai a servidor nem a Referer) e só o app, com a sessão e o verificador
  // de quem iniciou, conclui o vínculo pelo POST acima.
  return back("retorno", `#gcal_code=${encodeURIComponent(code)}&gcal_state=${encodeURIComponent(state)}`)
}
