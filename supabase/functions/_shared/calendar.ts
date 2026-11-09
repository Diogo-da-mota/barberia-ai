// Evento do Google Calendar a partir do payload do outbox (F10-03). Módulo puro.
// Sem telefone nem e-mail do cliente: o calendário do profissional só recebe o necessário para o atendimento.

export type CalendarPayload = {
  booking_id: string
  servico: string
  cliente: string
  profissional?: string
  inicio: string
  fim: string
  fuso: string
  barbearia?: string
  endereco?: string | null
}

export function buildGoogleEvent(p: CalendarPayload) {
  return {
    summary: `${p.servico} — ${p.cliente}`,
    description: `${p.barbearia ?? "Barberia AI"} · agendado pelo Barberia AI`,
    location: p.endereco ?? undefined,
    start: { dateTime: new Date(p.inicio).toISOString(), timeZone: p.fuso },
    end: { dateTime: new Date(p.fim).toISOString(), timeZone: p.fuso },
    // Chave privada para encontrar o evento de novo e não criar duplicados
    extendedProperties: { private: { barberiaBookingId: p.booking_id } },
  }
}

// PKCE (RFC 7636, S256) do vínculo com o Google Agenda. O verificador fica num cookie HttpOnly do navegador que
// iniciou o fluxo: um link de consentimento montado por outra pessoa não completa o vínculo.
export const PKCE_COOKIE = "gcal_pkce"

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  return { verifier, challenge: await pkceChallenge(verifier) }
}

export function pkceCookie(value: string, maxAgeSeconds: number, path: string): string {
  return `${PKCE_COOKIE}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`
}

export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=")
    if (key === name) return value.join("=") || null
  }
  return null
}
