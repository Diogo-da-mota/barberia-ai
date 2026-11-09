// Worker do outbox (F08-03, F08-06, F10-03). NÃO IMPLANTADO.
// Chamada POST com o cabeçalho x-worker-secret. Dois escopos:
//   corpo {"escopo":"confirmacoes_lembretes"} → o que o workflow n8n/barberia-fila-whatsapp.json dispara a cada minuto:
//     agenda os lembretes e entrega só confirmações e lembretes pela instância Evolution de cada barbearia
//     (secrets EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_WEBHOOK_SECRET, EVOLUTION_WEBHOOK_BASE_URL).
//   sem corpo → fila inteira, como antes (WhatsApp Cloud API da Meta e Google Calendar).
//   supabase secrets set WORKER_SECRET=... WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
//   supabase functions deploy outbox-worker --no-verify-jwt
// Entrega "pelo menos uma vez": se o worker cair depois de enviar e antes de registrar, o evento volta à fila após 10 minutos.
// Mensagens iniciadas pela empresa fora da janela de 24h exigem modelos (templates) aprovados pela Meta: ajuste sendWhatsApp
// para o modelo aprovado antes de produção.
import { createClient } from "npm:@supabase/supabase-js@2"
import { buildGoogleEvent, type CalendarPayload } from "../_shared/calendar.ts"
import { evoSendText } from "../_shared/evolution-client.ts"
import { ConfigError, loadEvolutionConfig } from "../_shared/evolution-config.ts"
import { buildMessage, toE164, type EventPayload } from "../_shared/messages.ts"
import { safeEqual } from "../_shared/webhook.ts"
import { processarConfirmacoesELembretes } from "../_shared/whatsapp-outbox.ts"

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void }

type Outbox = { id: string; barbershop_id: string; booking_id: string | null; tipo: string; canal: string; destino: string; payload: Record<string, unknown> }

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
const TIMEOUT = 10_000

async function sendWhatsApp(destino: string, text: string): Promise<string> {
  const token = Deno.env.get("WHATSAPP_TOKEN")
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")
  if (!token || !phoneId) throw new Error("whatsapp_sem_credenciais")
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: toE164(destino), type: "text", text: { body: text } }),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!res.ok) throw new Error(`whatsapp_http_${res.status}`)
  const json = (await res.json()) as { messages?: { id: string }[] }
  const id = json.messages?.[0]?.id
  if (!id) throw new Error("whatsapp_sem_id")
  return id
}

async function googleAccessToken(professionalId: string): Promise<string> {
  const { data: refresh } = await supabase.rpc("get_calendar_refresh_token", { p_professional_id: professionalId })
  if (!refresh) throw new Error("calendar_sem_token")
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "", client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
      refresh_token: refresh as string, grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!res.ok) throw new Error(`google_token_${res.status}`)
  return ((await res.json()) as { access_token: string }).access_token
}

async function syncCalendar(e: Outbox): Promise<void> {
  const { data } = await supabase.rpc("get_calendar_target", { p_booking_id: e.booking_id })
  const target = (data as { connection_id: string | null; calendar_id: string | null; professional_id: string; external_event_id: string | null }[] | null)?.[0]
  if (!target?.connection_id || !target.calendar_id) throw new Error("calendar_sem_vinculo_ativo")
  const access = await googleAccessToken(target.professional_id)
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.calendar_id)}/events`
  const headers = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }

  if (e.tipo === "calendar_delete") {
    if (target.external_event_id) {
      const res = await fetch(`${base}/${encodeURIComponent(target.external_event_id)}`, { method: "DELETE", headers, signal: AbortSignal.timeout(TIMEOUT) })
      if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`google_delete_${res.status}`)
    }
    await supabase.rpc("complete_calendar_sync", { p_booking_id: e.booking_id, p_connection_id: target.connection_id, p_external_event_id: null, p_etag: null, p_deleted: true })
    return
  }
  const event = buildGoogleEvent(e.payload as unknown as CalendarPayload)
  const res = target.external_event_id
    ? await fetch(`${base}/${encodeURIComponent(target.external_event_id)}`, { method: "PATCH", headers, body: JSON.stringify(event), signal: AbortSignal.timeout(TIMEOUT) })
    : await fetch(base, { method: "POST", headers, body: JSON.stringify(event), signal: AbortSignal.timeout(TIMEOUT) })
  if (!res.ok) throw new Error(`google_upsert_${res.status}`)
  const saved = (await res.json()) as { id: string; etag?: string }
  await supabase.rpc("complete_calendar_sync", { p_booking_id: e.booking_id, p_connection_id: target.connection_id, p_external_event_id: saved.id, p_etag: saved.etag ?? null, p_deleted: false })
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("WORKER_SECRET") ?? ""
  if (req.method !== "POST" || !secret || !safeEqual(req.headers.get("x-worker-secret") ?? "", secret)) return new Response("forbidden", { status: 403 })

  const corpo = (await req.json().catch(() => null)) as { escopo?: string } | null
  if (corpo?.escopo === "confirmacoes_lembretes") {
    try {
      const evolution = loadEvolutionConfig()
      const resultado = await processarConfirmacoesELembretes(
        async (fn, args) => {
          const { data, error } = await supabase.rpc(fn, args)
          return { data, error }
        },
        async (instancia, numero, texto) => (await evoSendText(evolution, instancia, { number: numero, text: texto })).messageId,
      )
      return Response.json(resultado)
    } catch (err) {
      const status = err instanceof ConfigError ? 503 : 500
      return Response.json({ error: err instanceof Error ? err.message : "erro" }, { status })
    }
  }

  await supabase.rpc("schedule_reminders")
  await supabase.rpc("schedule_reactivation")
  const { data, error } = await supabase.rpc("claim_outbox", { p_limit: 20 })
  if (error) return new Response("claim failed", { status: 500 })

  let sent = 0
  let failed = 0
  for (const e of (data ?? []) as Outbox[]) {
    try {
      let providerId: string | null = null
      if (e.canal === "google_calendar") {
        await syncCalendar(e)
      } else {
        const text = buildMessage(e.tipo, e.payload as EventPayload)
        if (!text) throw new Error("tipo_sem_mensagem")
        providerId = await sendWhatsApp(e.destino, text)
      }
      await supabase.rpc("complete_outbox", { p_id: e.id, p_ok: true, p_provider_message_id: providerId, p_erro: null })
      sent++
    } catch (err) {
      failed++
      await supabase.rpc("complete_outbox", { p_id: e.id, p_ok: false, p_provider_message_id: null, p_erro: err instanceof Error ? err.message : "erro" })
    }
  }
  return Response.json({ sent, failed })
})
