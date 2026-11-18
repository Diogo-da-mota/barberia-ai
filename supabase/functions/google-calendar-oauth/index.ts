// Vínculo do Google Calendar por profissional (F10-01/02). NÃO IMPLANTADO: exige projeto Google Cloud com a Calendar API ativada.
//   supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... APP_URL=https://seu-dominio
//   supabase functions deploy google-calendar-oauth --no-verify-jwt
// Fluxo: o app chama start_calendar_link (state de uso único, 10 min), guarda o verificador PKCE no próprio navegador e abre esta
// função com ?state=&code_challenge=. O retorno do Google volta ao app, que conclui por POST com a sessão do painel; só a conta
// dona do profissional do state conclui (migration 0047). Pedimos SÓ o escopo calendar.events; o banco confere o escopo
// concedido (complete_calendar_link) e o refresh token fica só no servidor. Lógica em _shared/calendar-oauth.ts.
import { createClient } from "npm:@supabase/supabase-js@2.119.0"
import { handleCalendarOAuth } from "../_shared/calendar-oauth.ts"

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void }

Deno.serve((req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
  return handleCalendarOAuth(req, {
    env: (name) => Deno.env.get(name),
    rpc: async (fn, args) => {
      const { data, error } = await supabase.rpc(fn, args)
      return { data, error: error ? { message: error.message } : null }
    },
    userId: async (jwt) => (await supabase.auth.getUser(jwt)).data.user?.id ?? null,
    professionalOf: async (id) => (await supabase.from("calendar_connections").select("professional_id").eq("id", id).maybeSingle()).data?.professional_id ?? null,
    fetch: (input, init) => fetch(input, init),
  })
})
