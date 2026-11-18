import { supabase } from "@/lib/supabase"

export type CalendarConnection = { status: "aguardando_consentimento" | "ativo" | "desvinculado"; calendar_id: string | null; consentido_em: string | null }

/** Google Calendar só aparece como disponível quando o administrador ativou a integração no servidor. */
export const calendarEnabled = () => import.meta.env.VITE_GOOGLE_CALENDAR_ENABLED === "true"

export async function fetchMyProfessional(shopId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("my_professional", { p_barbershop_id: shopId })
  if (error) throw error
  return (data as string | null) ?? null
}

export async function fetchConnection(professionalId: string): Promise<CalendarConnection | null> {
  const { data, error } = await supabase.from("calendar_connections").select("status, calendar_id, consentido_em").eq("professional_id", professionalId).maybeSingle()
  if (error) throw error
  return (data as CalendarConnection | null) ?? null
}

const pkceKey = (state: string) => `barberia:gcal-pkce:${state}`
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

/**
 * Gera o state de uso único e leva a pessoa à tela de consentimento do Google (função de servidor). O verificador PKCE fica
 * só neste navegador: o vínculo é concluído aqui, com a sessão de quem iniciou (finishLink). Um link aberto por outra pessoa
 * não conclui (migration 0047).
 */
export async function startLink(professionalId: string): Promise<string> {
  const { data, error } = await supabase.rpc("start_calendar_link", { p_professional_id: professionalId })
  if (error) throw error
  const state = data as string
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))
  sessionStorage.setItem(pkceKey(state), verifier)
  const base = import.meta.env.VITE_SUPABASE_URL as string
  return `${base}/functions/v1/google-calendar-oauth?state=${encodeURIComponent(state)}&code_challenge=${challenge}`
}

/** Retorno do Google no app (…/mais?calendario=retorno#gcal_code=…&gcal_state=…), ou null. */
export function readCalendarReturn(hash: string): { code: string; state: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""))
  const code = params.get("gcal_code")
  const state = params.get("gcal_state")
  return code && state ? { code, state } : null
}

/** Conclui o vínculo com a sessão do painel e o verificador guardado neste navegador (sem ele, o link não foi iniciado aqui). */
export async function finishLink(code: string, state: string): Promise<void> {
  let verifier: string | null = null
  try {
    verifier = sessionStorage.getItem(pkceKey(state))
    sessionStorage.removeItem(pkceKey(state))
  } catch {
    verifier = null
  }
  if (!verifier) throw new Error("outro_navegador")
  const { error } = await supabase.functions.invoke("google-calendar-oauth", { body: { code, state, code_verifier: verifier } })
  if (error) throw error
}

export async function unlink(professionalId: string): Promise<void> {
  const { error } = await supabase.rpc("unlink_calendar", { p_professional_id: professionalId })
  if (error) throw error
}
