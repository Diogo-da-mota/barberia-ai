// Verificação de assinatura e leitura do webhook do WhatsApp Cloud API. Módulo puro: sem rede e sem Deno.

const encoder = new TextEncoder()

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")

/** HMAC-SHA256 do corpo bruto no formato "sha256=<hex>" (o mesmo do cabeçalho X-Hub-Signature-256). */
export async function signHmacSha256(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return `sha256=${toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(body)))}`
}

/** Comparação em tempo constante (sem atalho no primeiro byte diferente). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Sem segredo configurado, cabeçalho ausente ou fora do formato: sempre falso. */
export async function verifyHmacSha256(body: string, header: string | null, secret: string): Promise<boolean> {
  if (!secret || !header || !/^sha256=[0-9a-f]{64}$/.test(header)) return false
  return safeEqual(await signHmacSha256(body, secret), header)
}

export type InboundMessage = { eventId: string; from: string; ts: Date; text: string; contextId: string | null }

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

/** Extrai só mensagens de texto ou botão. Status de entrega, mídia e payloads malformados são ignorados. */
export function parseWhatsAppPayload(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = []
  const entries = asRecord(payload)?.entry
  if (!Array.isArray(entries)) return out
  for (const entry of entries) {
    const changes = asRecord(entry)?.changes
    if (!Array.isArray(changes)) continue
    for (const change of changes) {
      const messages = asRecord(asRecord(change)?.value)?.messages
      if (!Array.isArray(messages)) continue
      for (const raw of messages) {
        const m = asRecord(raw)
        if (!m || typeof m.id !== "string" || typeof m.from !== "string") continue
        const text = m.type === "text" ? asRecord(m.text)?.body : m.type === "button" ? asRecord(m.button)?.text : undefined
        const seconds = Number(m.timestamp)
        if (typeof text !== "string" || !Number.isFinite(seconds)) continue
        const contextId = asRecord(m.context)?.id
        out.push({ eventId: m.id, from: m.from, ts: new Date(seconds * 1000), text, contextId: typeof contextId === "string" ? contextId : null })
      }
    }
  }
  return out
}
