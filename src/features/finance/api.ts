import { supabase } from "@/lib/supabase"
import type { CommissionStatus, ExpenseForm, ExpenseFrequency, ExpenseStatus, PaymentForm, RuleKind } from "./domain"

export type Report = {
  previsto_centavos: number
  recebido_centavos: number
  custos_centavos: number
  comissoes_provisionadas_centavos: number
  comissoes_liquidadas_centavos: number
  resultado_estimado_centavos: number
  /** Pendentes com vencimento no período: obrigação, fora de Custos e do Resultado. 0 enquanto a migration 0029 não está no banco. */
  despesas_a_pagar_centavos: number
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
    despesas_a_pagar_centavos: num(row?.despesas_a_pagar_centavos),
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

/** Custos REALIZADOS no período (Resumo): pagas pela data e valor do pagamento + lançamentos antigos pela própria data. Pendentes ficam de fora. */
export async function fetchExpenses(shopId: string, de: string, ate: string): Promise<ExpenseRow[]> {
  const { data, error } = await supabase
    .from("expenses").select("id, descricao, categoria, valor_centavos, data, situacao, pago_em, valor_pago_centavos")
    .eq("barbershop_id", shopId)
    .or(`and(situacao.eq.legado,data.gte.${de},data.lte.${ate}),and(situacao.eq.paga,pago_em.gte.${de},pago_em.lte.${ate})`)
    .limit(1000)
  if (error) {
    if ((error as { code?: string }).code !== "42703") throw error
    // banco ainda sem a migration 0029: todo custo é um lançamento antigo
    const old = await supabase.from("expenses").select("id, descricao, categoria, valor_centavos, data")
      .eq("barbershop_id", shopId).gte("data", de).lte("data", ate).order("data", { ascending: false })
    if (old.error) throw old.error
    return old.data as ExpenseRow[]
  }
  return (data as ExpenseEntry[])
    .map((e) => ({ id: e.id, descricao: e.descricao, categoria: e.categoria, valor_centavos: e.valor_pago_centavos ?? e.valor_centavos, data: e.pago_em ?? e.data }))
    .sort((a, b) => b.data.localeCompare(a.data))
}

/** Conta da aba Despesas. `data` é o vencimento (nos lançamentos antigos, a data do custo). */
export type ExpenseEntry = {
  id: string; descricao: string; categoria: string; valor_centavos: number; data: string; situacao: ExpenseStatus
  pago_em: string | null; valor_pago_centavos: number | null; forma: ExpenseForm | null; linha_digitavel: string | null; recurrence_id: string | null
}
export type ExpenseRecurrence = { id: string; descricao: string; categoria: string; valor_centavos: number; frequencia: ExpenseFrequency; inicio: string }

/**
 * Aba Despesas, um mês por vez: cria as contas recorrentes que faltam até o fim do mês e lê as contas com VENCIMENTO no mês
 * (pendentes, pagas e lançamentos antigos), mais as recorrências ativas. Sem a migration 0030, usa a sincronização antiga (35 dias).
 */
export async function fetchExpenseBook(shopId: string, de: string, ate: string): Promise<{ entries: ExpenseEntry[]; recurrences: ExpenseRecurrence[] }> {
  let sync = await supabase.rpc("sync_expense_recurrences", { p_barbershop_id: shopId, p_ate: ate })
  if (sync.error?.code === "PGRST202") sync = await supabase.rpc("sync_expense_recurrences", { p_barbershop_id: shopId })
  if (sync.error) throw sync.error
  const [entries, recurrences] = await Promise.all([
    supabase.from("expenses")
      .select("id, descricao, categoria, valor_centavos, data, situacao, pago_em, valor_pago_centavos, forma, linha_digitavel, recurrence_id")
      .eq("barbershop_id", shopId).gte("data", de).lte("data", ate)
      .order("data").order("criado_em").limit(2000),
    supabase.from("expense_recurrences").select("id, descricao, categoria, valor_centavos, frequencia, inicio")
      .eq("barbershop_id", shopId).is("encerrada_em", null).order("criado_em"),
  ])
  if (entries.error) throw entries.error
  if (recurrences.error) throw recurrences.error
  return { entries: entries.data as ExpenseEntry[], recurrences: recurrences.data as ExpenseRecurrence[] }
}

export type ExpenseInput = { descricao: string; categoria: string; valor: number; vencimento: string; forma: ExpenseForm | null; linha: string | null }

/** `id` nasce na tela: repetir a chamada depois de uma falha de rede não cria a despesa duas vezes. */
export async function createExpense(input: ExpenseInput & { id: string; shopId: string; frequencia: ExpenseFrequency | null; pagoEm: string | null }): Promise<void> {
  const { error } = await supabase.rpc("create_expense", {
    p_id: input.id, p_barbershop_id: input.shopId, p_descricao: input.descricao, p_categoria: input.categoria, p_valor_centavos: input.valor,
    p_vencimento: input.vencimento, p_forma: input.forma, p_linha_digitavel: input.linha, p_frequencia: input.frequencia,
    p_pago_em: input.pagoEm, p_valor_pago_centavos: input.pagoEm ? input.valor : null,
  })
  if (error) throw error
}

/** Várias despesas em UMA chamada e uma transação (tudo ou nada). Cada linha leva o próprio id: reenviar não duplica. Linha inválida: `invalid_expense_line:N`. */
export async function createExpenses(shopId: string, items: (ExpenseInput & { id: string; frequencia: ExpenseFrequency | null; pagoEm: string | null })[]): Promise<void> {
  const { error } = await supabase.rpc("create_expenses", {
    p_barbershop_id: shopId,
    p_items: items.map((i) => ({ id: i.id, descricao: i.descricao, categoria: i.categoria, valor_centavos: i.valor, vencimento: i.vencimento, forma: i.forma, linha_digitavel: i.linha, frequencia: i.frequencia, pago_em: i.pagoEm })),
  })
  if (error) throw error
}

/** Descrição e categoria de qualquer conta (inclusive paga ou lançamento antigo); não mexe em valor, datas nem pagamento. */
export async function updateExpenseDetails(id: string, descricao: string, categoria: string): Promise<void> {
  const { error } = await supabase.rpc("update_expense_details", { p_id: id, p_descricao: descricao, p_categoria: categoria })
  if (error) throw error
}

/** Desfaz um pagamento lançado por engano: a conta volta a pendente e o razão recebe o lançamento compensatório. */
export async function revertExpensePayment(id: string): Promise<void> {
  const { error } = await supabase.rpc("revert_expense_payment", { p_id: id })
  if (error) throw error
}

export type ExpenseEvent = { id: string; tipo: "pagamento" | "reversao"; pago_em: string; valor_centavos: number; forma: ExpenseForm | null; criado_em: string }

/** Histórico de pagamentos e reversões de uma conta, do mais antigo para o mais recente. Banco sem a 0031: lista vazia. */
export async function fetchExpenseEvents(expenseId: string): Promise<ExpenseEvent[]> {
  const { data, error } = await supabase.from("expense_events").select("id, tipo, pago_em, valor_centavos, forma, criado_em").eq("expense_id", expenseId).order("criado_em")
  if (error) {
    if ((error as { code?: string }).code === "PGRST205") return []
    throw error
  }
  return data as ExpenseEvent[]
}

export async function updateExpense(id: string, input: ExpenseInput): Promise<void> {
  const { error } = await supabase.rpc("update_expense", {
    p_id: id, p_descricao: input.descricao, p_categoria: input.categoria, p_valor_centavos: input.valor,
    p_vencimento: input.vencimento, p_forma: input.forma, p_linha_digitavel: input.linha,
  })
  if (error) throw error
}

export async function payExpense(id: string, input: { pagoEm: string; valor: number; forma: ExpenseForm }): Promise<void> {
  const { error } = await supabase.rpc("pay_expense", { p_id: id, p_pago_em: input.pagoEm, p_valor_pago_centavos: input.valor, p_forma: input.forma })
  if (error) throw error
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_expense", { p_id: id })
  if (error) throw error
}

export async function endExpenseRecurrence(id: string): Promise<void> {
  const { error } = await supabase.rpc("end_expense_recurrence", { p_id: id })
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
