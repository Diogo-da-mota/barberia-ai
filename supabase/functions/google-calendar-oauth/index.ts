// Vínculo do Google Calendar por profissional (F10-01/02). NÃO IMPLANTADO: exige projeto Google Cloud com a Calendar API ativada.
//   supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... APP_URL=https://seu-dominio
//   supabase functions deploy google-calendar-oauth --no-verify-jwt
// Fluxo: o app chama start_calendar_link (gera state de uso único, 10 min) e redireciona para esta função com ?state=.
// Aqui pedimos SÓ o escopo calendar.events (login com Google não dá acesso ao Calendar). No retorno trocamos o código, o banco
// confere o escopo concedido (complete_calendar_link recusa escopo ausente ou amplo demais) e o refresh token fica só no servidor.
import { createClient } from "npm:@supabase/supabase-js@2"
import { PKCE_COOKIE, createPkcePair, pkceCookie, readCookie } from "../_shared/calendar.ts"

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void }

const SCOPE = "https://www.googleapis.com/auth/calendar.events"
const COOKIE_PATH = "/functions/v1/google-calendar-oauth"

const redirect = (location: string, cookie: string) =>
  new Response(null, { status: 302, headers: { Location: location, "Set-Cookie": cookie } })

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const app = Deno.env.get("APP_URL") ?? ""
  const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-calendar-oauth`
  // Volta ao painel e apaga o verificador PKCE (uso único)
  const back = (status: string) => redirect(`${app}/dashboard/mais?calendario=${status}`, pkceCookie("", 0, COOKIE_PATH))
  const state = url.searchParams.get("state") ?? ""
  const code = url.searchParams.get("code")

  // Recusa no Google (ex.: access_denied): volta ao painel em vez de reabrir o consentimento
  if (url.searchParams.has("error")) return back("erro")

  if (!code) {
    if (!state) return new Response("bad request", { status: 400 })
    const pkce = await createPkcePair()
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth")
    auth.search = new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "", redirect_uri: redirectUri, response_type: "code", scope: SCOPE,
      access_type: "offline", prompt: "consent", state, include_granted_scopes: "false",
      code_challenge: pkce.challenge, code_challenge_method: "S256",
    }).toString()
    return redirect(auth.toString(), pkceCookie(pkce.verifier, 600, COOKIE_PATH))
  }

  // Sem o verificador deste navegador o vínculo não continua (link de consentimento iniciado por outra pessoa)
  const verifier = readCookie(req.headers.get("cookie"), PKCE_COOKIE)
  if (!verifier) return back("erro")

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "", client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
      redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!token.ok) return back("erro")
  const tokens = (await token.json()) as { refresh_token?: string; scope?: string }
  if (!tokens.refresh_token) return back("erro")

  const { data: connectionId, error } = await supabase.rpc("complete_calendar_link", {
    p_state: state, p_calendar_id: "primary", p_escopos: (tokens.scope ?? "").split(" ").filter(Boolean),
  })
  if (error) return back(error.message.includes("scope") ? "escopo" : "erro")
  const { data: conn } = await supabase.from("calendar_connections").select("professional_id").eq("id", connectionId).single()
  if (!conn) return back("erro")
  await supabase.rpc("store_calendar_tokens", { p_professional_id: conn.professional_id, p_refresh_token: tokens.refresh_token })
  return back("ok")
})
