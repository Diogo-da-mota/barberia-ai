import { supabase } from "@/lib/supabase"
import type { CommissionStatus, PaymentForm, RuleKind } from "./domain"

export type Report = {
  previsto_centavos: number
  recebido_centavos: number
  custos_centavos: number
  comissoes_provisionadas_centavos: number
  comissoes_liquidadas_centavos: number
  resultado_estimado_centavos: number
}

export type CompletedBooking = {
  id: string
  cliente_nome: string
  servico_nome: string
  preco_centavos: number
  inicio: string
  professionals: { nome: string; avatar_path?: string | null } | null
}
/** `confirmado_em` nulo = declarado, "a confirmar": ainda NÃO soma no caixa. */
export type PaymentRow = { id: string; booking_id: string; valor_centavos: number; forma: PaymentForm; parcelas: number; criado_em: string; confirmado_em: string | null }
export type RefundRow = { id: string; payment_id: string; valor_centavos: number; motivo: string | null }
export type RuleRow = { id: string; professional_id: string | null; service_id: string | null; tipo: RuleKind; valor: number }
export type CommissionRow = {
  id: string
  booking_id: string
  professional_id: string
  valor_centavos: number
  base_centavos: number
  regra_tipo: RuleKind
  regra_valor: number
  status: CommissionStatus
  criado_em: string
  professionals: { nome: string; avatar_path?: string | null } | null
}
export type PayoutRow = { id: string; professional_id: string; valor_centavos: number; criado_em: string; professionals: { nome: string; avatar_path?: string | null } | null }
export type ExpenseRow = { id: string; descricao: string; categoria: string; valor_centavos: number; data: string }

/** Pagamento com o atendimento (cliente, serviço, profissional): só leitura, para Resumo e Pagamentos. */
export type PaymentDetail = PaymentRow & { bookings: { cliente_nome: string; servico_nome: string; professionals: { nome: string } | null } | null }
export type RefundDetail = RefundRow & { criado_em: string; payments: { forma: PaymentForm; bookings: PaymentDetail["bookings"] } | null }

const num = (v: unknown) => Number(v ?? 0)

export async function fetchReport(shopId: string, de: string, ate: string): Promise<Report> {
  const { data, error } = await supabase.rpc("finance_report", { p_barbershop_id: shopId, p_de: de, p_ate: ate })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined
  return {
    previsto_centavos: num(row?.previsto_centavos),
    recebido_centavos: num(row?.recebido_centavos),
    custos_centavos: num(row?.custos_centavos),
    comissoes_provisionadas_centavos: num(row?.comissoes_provisionadas_centavos),
    comissoes_liquidadas_centavos: num(row?.comissoes_liquidadas_centavos),
    resultado_estimado_centavos: num(row?.resultado_estimado_centavos),
  }
}

export async function fetchCompletedBookings(shopId: string): Promise<CompletedBooking[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select("id, cliente_nome, servico_nome, preco_centavos, inicio, professionals(nome, avatar_path)")
    .eq("barbershop_id", shopId)
    .eq("status", "concluido")
    .order("inicio", { ascending: false })
    .limit(50)
  if (error) throw error
  return data as unknown as CompletedBooking[]
}

export async function fetchPayments(bookingIds: string[]): Promise<{ payments: PaymentRow[]; refunds: RefundRow[] }> {
  if (bookingIds.length === 0) return { payments: [], refunds: [] }
  const payments = await supabase.from("payments").select("id, booking_id, valor_centavos, forma, parcelas, criado_em, confirmado_em").in("booking_id", bookingIds)
  if (payments.error) throw payments.error
  const ids = (payments.data ?? []).map((p) => p.id as string)
  if (ids.length === 0) return { payments: [], refunds: [] }
  const refunds = await supabase.from("refunds").select("id, payment_id, valor_centavos, motivo").in("payment_id", ids)
  if (refunds.error) throw refunds.error
  return { payments: payments.data as PaymentRow[], refunds: (refunds.data ?? []) as RefundRow[] }
}

export async function registerPayment(input: { bookingId: string; valor: number; forma: PaymentForm; parcelas: number; key: string }): Promise<string> {
  const { data, error } = await supabase.rpc("register_payment", {
    p_booking_id: input.bookingId, p_valor_centavos: input.valor, p_forma: input.forma, p_parcelas: input.parcelas, p_idempotency_key: input.key,
  })
  if (error) throw error
  return data as string
}

/** Só a confirmação faz o valor entrar no caixa. */
export async function confirmPayment(paymentId: string): Promise<void> {
  const { error } = await supabase.rpc("confirm_payment", { p_payment_id: paymentId })
  if (error) throw error
}

/** Descarta um pagamento declarado por engano (ainda não confirmado). */
export async function discardPayment(paymentId: string): Promise<void> {
  const { error } = await supabase.rpc("discard_payment", { p_payment_id: paymentId })
  if (error) throw error
}

export async function refundPayment(input: { paymentId: string; valor: number; motivo: string; key: string }): Promise<string> {
  const { data, error } = await supabase.rpc("refund_payment", {
    p_payment_id: input.paymentId, p_valor_centavos: input.valor, p_motivo: input.motivo || null, p_idempotency_key: input.key,
  })
  if (error) throw error
  return data as string
}

export async function fetchRules(shopId: string): Promise<RuleRow[]> {
  const { data, error } = await supabase.from("commission_rules").select("id, professional_id, service_id, tipo, valor").eq("barbershop_id", shopId)
  if (error) throw error
  return data as RuleRow[]
}

export async function saveRule(input: { shopId: string; professionalId: string | null; serviceId: string | null; tipo: RuleKind; valor: number }): Promise<void> {
  const { error } = await supabase.rpc("save_commission_rule", {
    p_barbershop_id: input.shopId, p_professional_id: input.professionalId, p_service_id: input.serviceId, p_tipo: input.tipo, p_valor: input.valor,
  })
  if (error) throw error
}

export async function deleteRule(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_commission_rule", { p_id: id })
  if (error) throw error
}

/** O RLS limita o barbeiro às próprias comissões. */
export async function fetchCommissions(shopId: string): Promise<CommissionRow[]> {
  const { data, error } = await supabase
    .from("commissions")
    .select("id, booking_id, professional_id, valor_centavos, base_centavos, regra_tipo, regra_valor, status, criado_em, professionals(nome, avatar_path)")
    .eq("barbershop_id", shopId)
    .order("criado_em", { ascending: false })
    .limit(200)
  if (error) throw error
  return data as unknown as CommissionRow[]
}

export async function fetchPayouts(shopId: string): Promise<PayoutRow[]> {
  const { data, error } = await supabase
    .from("payouts")
    .select("id, professional_id, valor_centavos, criado_em, professionals(nome, avatar_path)")
    .eq("barbershop_id", shopId)
    .order("criado_em", { ascending: false })
    .limit(100)
  if (error) throw error
  return data as unknown as PayoutRow[]
}

export async function createPayout(professionalId: string, key: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_payout", { p_professional_id: professionalId, p_idempotency_key: key })
  if (error) throw error
  return data as string
}

export async function fetchExpenses(shopId: string, de: string, ate: string): Promise<ExpenseRow[]> {
  const { data, error } = await supabase
    .from("expenses").select("id, descricao, categoria, valor_centavos, data")
    .eq("barbershop_id", shopId).gte("data", de).lte("data", ate).order("data", { ascending: false })
  if (error) throw error
  return data as ExpenseRow[]
}

export async function addExpense(input: { shopId: string; descricao: string; categoria: string; valor: number; data: string }): Promise<void> {
  const { error } = await supabase.rpc("add_expense", {
    p_barbershop_id: input.shopId, p_descricao: input.descricao, p_categoria: input.categoria, p_valor_centavos: input.valor, p_data: input.data,
  })
  if (error) throw error
}

/** Pagamentos declarados ou confirmados perto do mês (janela UTC larga; o corte exato por data local é feito em `summary.ts`). */
export async function fetchPaymentsWindow(shopId: string, from: string, to: string): Promise<PaymentDetail[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("id, booking_id, valor_centavos, forma, parcelas, criado_em, confirmado_em, bookings(cliente_nome, servico_nome, professionals(nome))")
    .eq("barbershop_id", shopId)
    .or(`and(criado_em.gte.${from},criado_em.lt.${to}),and(confirmado_em.gte.${from},confirmado_em.lt.${to})`)
    .order("criado_em", { ascending: false })
    .limit(1000)
  if (error) throw error
  return data as unknown as PaymentDetail[]
}

export async function fetchRefundsWindow(shopId: string, from: string, to: string): Promise<RefundDetail[]> {
  const { data, error } = await supabase
    .from("refunds")
    .select("id, payment_id, valor_centavos, motivo, criado_em, payments(forma, bookings(cliente_nome, servico_nome, professionals(nome)))")
    .eq("barbershop_id", shopId)
    .gte("criado_em", from)
    .lt("criado_em", to)
    .order("criado_em", { ascending: false })
    .limit(500)
  if (error) throw error
  return data as unknown as RefundDetail[]
}
