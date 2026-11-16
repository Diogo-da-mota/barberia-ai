import { FunctionsHttpError } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

export type WhatsAppStatus = {
  provider: "evolution" | null
  connected: boolean
  state: string
  number: string | null
  profileName: string | null
  /** QR como data URL (data:image/png;base64,…), pronto para o <img>. Só vem de connect-instance. */
  qr?: string | null
  pairingCode?: string | null
}

/** Mensagem do servidor (ex.: Evolution não configurada) em vez do genérico "non-2xx status code". */
export async function functionError(error: unknown, fallback: string): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    const body = (await error.context.json().catch(() => null)) as { error?: string } | null
    if (body?.error) return new Error(body.error)
  }
  return new Error(error instanceof Error && error.message ? error.message : fallback)
}

export type WhatsAppConnectResponse = WhatsAppStatus

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL?.replace("/rest/v1", "") ?? ""

/**
 * Chama a Edge Function POST /functions/v1/connect-instance
 * Cria/reutiliza instância Evolution, configura webhook e retorna QR code.
 */
export async function connectWhatsApp(barbershopId: string): Promise<WhatsAppConnectResponse> {
  const { data, error } = await supabase.functions.invoke("connect-instance", {
    body: { barbershop_id: barbershopId },
  })
  if (error) throw await functionError(error, "Erro ao conectar WhatsApp")
  return data as WhatsAppConnectResponse
}

/**
 * Chama a Edge Function GET /functions/v1/instance-status?barbershop_id=...
 * Retorna estado atual da instância (para polling do QR).
 * Usa fetch direto para suportar query parameters.
 */
export async function getWhatsAppStatus(barbershopId: string): Promise<WhatsAppStatus> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error("Sessão expirada")

  const url = `${FUNCTIONS_URL}/functions/v1/instance-status?barbershop_id=${encodeURIComponent(barbershopId)}`
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || "Erro ao buscar status")
  }

  return response.json() as Promise<WhatsAppStatus>
}

/**
 * Chama a Edge Function DELETE /functions/v1/disconnect-instance
 * Desconecta e deleta instância Evolution + remove row de integration_accounts.
 */
export async function disconnectWhatsApp(barbershopId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("disconnect-instance", {
    method: "DELETE",
    body: { barbershop_id: barbershopId },
  })
  if (error) throw await functionError(error, "Erro ao desconectar WhatsApp")
}