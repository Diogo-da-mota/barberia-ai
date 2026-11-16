import { supabase } from "@/lib/supabase"
import { toast } from "@/ui/sonner"
import type { BookingRow, CustomerBooking, GridSlot, HoursRow, PublicShopData, Slot } from "./domain"
import { addDays, isMissingSchema } from "./domain"

const BOOKING_COLUMNS =
  "id, barbershop_id, professional_id, customer_id, service_id, servico_nome, preco_centavos, duracao_min, inicio, fim, status, cliente_nome, cliente_whatsapp, professionals(nome, avatar_path)"

export async function getPublicShop(slug: string): Promise<PublicShopData | null> {
  const { data, error } = await supabase.rpc("get_public_shop", { p_slug: slug })
  if (error) throw error
  return (data as PublicShopData | null) ?? null
}

export async function getAvailability(shopId: string, serviceId: string, professionalId: string | null, date: string): Promise<Slot[]> {
  const { data, error } = await supabase.rpc("get_availability", {
    p_barbershop_id: shopId, p_service_id: serviceId, p_professional_id: professionalId, p_data: date,
  })
  if (error) throw error
  return (data ?? []) as Slot[]
}

/**
 * Grade do dia com livre e ocupado de cada profissional do serviço (get_slot_grid). `bookingId`: no reagendamento, a própria
 * reserva não conta como conflito. Sem a função no banco (SQL ainda não aplicado), volta aos horários livres de antes.
 */
export async function getSlotGrid(shopId: string, serviceId: string, date: string, bookingId: string | null = null): Promise<GridSlot[]> {
  const { data, error } = await supabase.rpc("get_slot_grid", { p_barbershop_id: shopId, p_service_id: serviceId, p_data: date, p_booking_id: bookingId })
  // snip: fallback só até o SQL ser aplicado; depois pode sair
  if (error && isMissingSchema(error)) return (await getAvailability(shopId, serviceId, null, date)).map((s) => ({ ...s, livre: true }))
  if (error) throw error
  return (data ?? []) as GridSlot[]
}

export type BookingInput = {
  shopId: string
  serviceId: string
  professionalId: string | null
  inicio: string
  nome: string
  whatsapp: string
  lembretes: boolean
  marketing: boolean
  key: string
}

export async function createBooking(input: BookingInput): Promise<string> {
  const { data, error } = await supabase.rpc("create_booking", {
    p_barbershop_id: input.shopId, p_service_id: input.serviceId, p_professional_id: input.professionalId, p_inicio: input.inicio,
    p_nome: input.nome, p_whatsapp: input.whatsapp, p_consent_lembretes: input.lembretes, p_consent_marketing: input.marketing,
    p_idempotency_key: input.key,
  })
  if (error) throw error
  // Conta sem WhatsApp (ex.: entrou com Google): guarda o número da reserva no perfil (só preenche se estiver vazio; 0022)
  try { await supabase.rpc("fill_my_whatsapp", { p_whatsapp: input.whatsapp }) } catch { /* não impede a reserva */ }
  return data as string
}

/** WhatsApp salvo no perfil da conta logada (null = ainda não informado, ex.: entrou com Google). */
export async function fetchMyWhatsapp(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user.id
  if (!userId) return null
  const { data, error } = await supabase.from("profiles").select("whatsapp").eq("id", userId).maybeSingle()
  if (error) throw error
  return (data as { whatsapp: string | null } | null)?.whatsapp ?? null
}

/** Preenche o WhatsApp do perfil só se estiver vazio (o banco nunca troca um número já salvo). */
export async function fillMyWhatsapp(whatsapp: string): Promise<void> {
  const { error } = await supabase.rpc("fill_my_whatsapp", { p_whatsapp: whatsapp })
  if (error) throw error
}

/** Agendamento feito pela gestão para cliente sem conta (0022): a reserva não fica na conta de quem agendou. */
export async function createManualBooking(input: {
  shopId: string; serviceId: string; professionalId: string; inicio: string; nome: string; whatsapp: string; email: string; lembretes: boolean; key: string
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_manual_booking", {
    p_barbershop_id: input.shopId, p_service_id: input.serviceId, p_professional_id: input.professionalId, p_inicio: input.inicio,
    p_nome: input.nome, p_whatsapp: input.whatsapp, p_consent_lembretes: input.lembretes, p_idempotency_key: input.key,
    p_email: input.email.trim() || null,
  })
  if (error) throw error
  return data as string
}

export async function cancelBooking(id: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_booking", { p_booking_id: id })
  if (error) throw error
}

export async function rescheduleBooking(id: string, inicio: string, professionalId: string | null, requestId: string): Promise<void> {
  const args = { p_booking_id: id, p_novo_inicio: inicio, p_professional_id: professionalId }
  const { error } = await supabase.rpc("reschedule_booking", { ...args, p_request_id: requestId })
  if (error?.code === "PGRST202") {
    // Durante a publicação, o banco pode ter apenas a assinatura anterior.
    const legacy = await supabase.rpc("reschedule_booking", args)
    if (legacy.error) throw legacy.error
    return
  }
  if (error) throw error
}

export async function setBookingStatus(id: string, status: "confirmado" | "concluido" | "nao_compareceu"): Promise<void> {
  const { error } = await supabase.rpc("set_booking_status", { p_booking_id: id, p_status: status })
  if (error) throw error
}

/** Reservas do cliente logado. O RLS já limita ao próprio usuário. */
/**
 * Reservas que a conta logada fez como cliente. O filtro por `customer_id` é obrigatório: para a equipe o banco também
 * libera as reservas da barbearia (RLS), e elas não podem aparecer misturadas em "Minhas reservas".
 */
export async function fetchMyBookings(): Promise<BookingRow[]> {
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user.id
  if (!userId) return []
  // Traz para a conta as reservas que a barbearia fez com o mesmo e-mail confirmado e o mesmo WhatsApp (0022; o banco valida)
  try {
    const { data: linked } = await supabase.rpc("link_my_bookings")
    if (typeof linked === "number" && linked > 0) {
      toast.success(linked === 1
        ? "Encontramos 1 reserva feita pela barbearia e ela já está na sua conta."
        : `Encontramos ${linked} reservas feitas pela barbearia e elas já estão na sua conta.`)
    }
  } catch { /* sem vínculo novo: segue com as reservas da conta */ }
  const { data, error } = await supabase
    .from("bookings")
    .select(`${BOOKING_COLUMNS}, barbershops(nome, fuso, slug)`)
    .eq("customer_id", userId)
    .order("inicio", { ascending: false })
    .limit(100)
  if (error) throw error
  return data as unknown as BookingRow[]
}

/** Reservas da barbearia (gestão), de 30 dias atrás até 60 dias à frente. */
export async function fetchShopBookings(shopId: string): Promise<BookingRow[]> {
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const to = new Date(Date.now() + 61 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("barbershop_id", shopId)
    .gte("inicio", from)
    .lte("inicio", to)
    .order("inicio")
    .limit(1000)
  if (error) throw error
  return data as unknown as BookingRow[]
}

/** Reservas do histórico da barbearia (o RLS limita o barbeiro às próprias). */
export async function fetchCustomerBookings(shopId: string): Promise<CustomerBooking[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select("customer_id, cliente_nome, cliente_whatsapp, inicio, status, preco_centavos, servico_nome, consent_lembretes, consent_marketing, criado_em")
    .eq("barbershop_id", shopId)
    .order("inicio", { ascending: false })
    .limit(2000)
  if (error) throw error
  return data as CustomerBooking[]
}

export type CustomerConsent = { profile_id: string; marketing: boolean; atualizado_em: string | null; opt_out_em: string | null }

/** Consentimento vigente de novidades e promoções (muda também por "PARAR" no WhatsApp). Só a gestão lê o de todos. */
export async function fetchCustomerConsents(shopId: string): Promise<CustomerConsent[]> {
  const { data, error } = await supabase.from("customer_consents").select("profile_id, marketing, atualizado_em, opt_out_em").eq("barbershop_id", shopId)
  if (error) throw error
  return data as CustomerConsent[]
}

export type BlockRow = { id: string; professional_id: string; periodo: string; motivo: string | null }

export async function fetchBlocks(shopId: string): Promise<BlockRow[]> {
  const { data, error } = await supabase
    .from("occupancies")
    .select("id, professional_id, periodo, motivo")
    .eq("barbershop_id", shopId)
    .eq("kind", "block")
    .limit(500)
  if (error) throw error
  return data as BlockRow[]
}

export async function createBlock(shopId: string, professionalId: string, inicio: string, fim: string, motivo: string): Promise<void> {
  const { error } = await supabase.rpc("create_block", {
    p_barbershop_id: shopId, p_professional_id: professionalId, p_inicio: inicio, p_fim: fim, p_motivo: motivo,
  })
  if (error) throw error
}

export async function deleteBlock(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_block", { p_id: id })
  if (error) throw error
}

/** Jornada de toda a equipe (leitura liberada aos membros da barbearia). */
export async function fetchShopHours(shopId: string): Promise<HoursRow[]> {
  const { data, error } = await supabase.from("working_hours").select("professional_id, dow, inicio_min, fim_min").eq("barbershop_id", shopId).limit(1000)
  if (error) throw error
  return data as HoursRow[]
}

export type HoursInterval = { dow: number; inicio_min: number; fim_min: number }

export async function fetchWorkingHours(professionalId: string): Promise<HoursInterval[]> {
  const { data, error } = await supabase.from("working_hours").select("dow, inicio_min, fim_min").eq("professional_id", professionalId).order("dow").order("inicio_min")
  if (error) throw error
  return data as HoursInterval[]
}

export async function saveWorkingHours(professionalId: string, intervals: HoursInterval[]): Promise<void> {
  const { error } = await supabase.rpc("save_working_hours", { p_professional_id: professionalId, p_intervals: intervals })
  if (error) throw error
}

export async function acceptInvite(token: string): Promise<string> {
  const { data, error } = await supabase.rpc("accept_invite", { p_token: token })
  if (error) throw error
  return data as string
}

export async function createInvite(shopId: string, email: string, papel: "gerente" | "barbeiro"): Promise<string> {
  const { data, error } = await supabase.rpc("create_invite", { p_barbershop_id: shopId, p_email: email, p_papel: papel })
  if (error) throw error
  return data as string
}

export type InviteRow = { id: string; email: string; papel: string; expires_at: string; aceito_em: string | null }

export async function fetchInvites(shopId: string): Promise<InviteRow[]> {
  const { data, error } = await supabase
    .from("invites")
    .select("id, email, papel, expires_at, aceito_em")
    .eq("barbershop_id", shopId)
    .order("criado_em", { ascending: false })
    .limit(30)
  if (error) throw error
  return data as InviteRow[]
}

export async function updateShopInfo(shopId: string, values: { nome: string; endereco: string | null; telefone?: string }): Promise<void> {
  const { data, error } = await supabase.from("barbershops").update(values).eq("id", shopId).select("id")
  if (error) throw error
  if (!data?.length) throw Object.assign(new Error("forbidden"), { code: "42501" })
}

export { addDays }
