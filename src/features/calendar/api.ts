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

/** Gera o state de uso único e leva a pessoa à tela de consentimento do Google (função de servidor). */
export async function startLink(professionalId: string): Promise<string> {
  const { data, error } = await supabase.rpc("start_calendar_link", { p_professional_id: professionalId })
  if (error) throw error
  const base = import.meta.env.VITE_SUPABASE_URL as string
  return `${base}/functions/v1/google-calendar-oauth?state=${encodeURIComponent(data as string)}`
}

export async function unlink(professionalId: string): Promise<void> {
  const { error } = await supabase.rpc("unlink_calendar", { p_professional_id: professionalId })
  if (error) throw error
}
