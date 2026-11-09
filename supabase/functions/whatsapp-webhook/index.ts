// Webhook do WhatsApp Cloud API (F08-02, F08-05). NÃO IMPLANTADO: exige conta WhatsApp Business aprovada e os secrets abaixo.
//   supabase secrets set WHATSAPP_APP_SECRET=... WHATSAPP_VERIFY_TOKEN=...
//   supabase functions deploy whatsapp-webhook --no-verify-jwt   (a autenticidade vem da assinatura HMAC, não do JWT)
// A função só valida a assinatura e repassa as respostas ao banco; toda a regra (replay, duplicidade, correlação,
// janela de cancelamento) está em process_whatsapp_reply, testada em supabase/tests/eventos.test.ts.
import { createClient } from "npm:@supabase/supabase-js@2"
import { parseWhatsAppPayload, safeEqual, verifyHmacSha256 } from "../_shared/webhook.ts"

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void }

const MAX_BODY_BYTES = 256 * 1024

Deno.serve(async (req) => {
  const secret = Deno.env.get("WHATSAPP_APP_SECRET") ?? ""
  const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? ""

  // Verificação inicial do webhook pelo provedor (GET com hub.challenge)
  if (req.method === "GET") {
    const url = new URL(req.url)
    const ok = verifyToken !== "" && url.searchParams.get("hub.mode") === "subscribe" && safeEqual(url.searchParams.get("hub.verify_token") ?? "", verifyToken)
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("forbidden", { status: 403 })
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 })

  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 })
  if (!(await verifyHmacSha256(raw, req.headers.get("x-hub-signature-256"), secret))) return new Response("invalid signature", { status: 401 })

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response("bad request", { status: 400 })
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
  let rateLimited = false
  for (const m of parseWhatsAppPayload(payload)) {
    const { error } = await supabase.rpc("process_whatsapp_reply", {
      p_event_id: m.eventId, p_ts: m.ts.toISOString(), p_from: m.from, p_context_message_id: m.contextId, p_texto: m.text,
    })
    if (error?.message?.includes("rate_limited")) rateLimited = true
    else if (error) console.error("process_whatsapp_reply falhou", error.code) // sem corpo da mensagem nos logs
  }
  // 429 faz o provedor tentar de novo mais tarde; os demais casos respondem 200 para não gerar reenvio infinito
  return new Response(rateLimited ? "rate limited" : "ok", { status: rateLimited ? 429 : 200 })
})
