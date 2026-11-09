import { addDays, localDate } from "@/features/booking/domain"
import type { CommissionRow, ExpenseRow, PaymentDetail, PayoutRow, RefundDetail } from "./api"

/** Só leitura e agrupamento de dados que já existem. Nenhuma regra financeira nova: Recebido, Custos e Resultado vêm de `finance_report`. */

export type DayPoint = { date: string; receita: number; custo: number }
export type Share = { key: string; cents: number }
export type MovementKind = "recebimento" | "estorno" | "repasse" | "custo"
export type Movement = {
  id: string
  at: string
  descricao: string
  kind: MovementKind
  /** Positivo entra, negativo sai. */
  cents: number
  status: "Confirmado" | "A confirmar" | "Estornado" | "Repassado" | "Lançado"
}

export const inRange = (date: string, range: { de: string; ate: string }) => date >= range.de && date <= range.ate

/** Janela UTC larga o bastante para cobrir o mês no fuso da barbearia; o corte exato é feito por `localDate`. */
export function utcWindow(range: { de: string; ate: string }): { from: string; to: string } {
  return { from: `${addDays(range.de, -1)}T00:00:00Z`, to: `${addDays(range.ate, 2)}T00:00:00Z` }
}

export function daysOf(range: { de: string; ate: string }): string[] {
  const out: string[] = []
  for (let d = range.de; d <= range.ate; d = addDays(d, 1)) out.push(d)
  return out
}

/** Pagamentos confirmados no período (data da confirmação no fuso da barbearia). */
export const confirmedIn = (payments: PaymentDetail[], range: { de: string; ate: string }, tz: string) =>
  payments.filter((p) => p.confirmado_em !== null && inRange(localDate(p.confirmado_em, tz), range))

export const refundsIn = (refunds: RefundDetail[], range: { de: string; ate: string }, tz: string) =>
  refunds.filter((r) => inRange(localDate(r.criado_em, tz), range))

/** Receita líquida (confirmado menos estornos) e custos por dia. */
export function dailySeries(
  range: { de: string; ate: string },
  tz: string,
  payments: PaymentDetail[],
  refunds: RefundDetail[],
  expenses: Pick<ExpenseRow, "data" | "valor_centavos">[],
): DayPoint[] {
  const map = new Map<string, DayPoint>(daysOf(range).map((date) => [date, { date, receita: 0, custo: 0 }]))
  for (const p of confirmedIn(payments, range, tz)) map.get(localDate(p.confirmado_em!, tz))!.receita += p.valor_centavos
  for (const r of refundsIn(refunds, range, tz)) map.get(localDate(r.criado_em, tz))!.receita -= r.valor_centavos
  for (const e of expenses) {
    const day = map.get(e.data)
    if (day) day.custo += e.valor_centavos
  }
  return [...map.values()]
}

/** Soma por chave, do maior para o menor; zeros ficam de fora. */
export function sumByKey(items: Share[]): Share[] {
  const map = new Map<string, number>()
  for (const i of items) map.set(i.key, (map.get(i.key) ?? 0) + i.cents)
  return [...map.entries()].filter(([, cents]) => cents > 0).map(([key, cents]) => ({ key, cents })).sort((a, b) => b.cents - a.cents)
}

export const MIN_TICKET_SAMPLE = 3

/** Ticket médio realizado: recebido líquido ÷ atendimentos com pagamento confirmado. Abaixo de 3 atendimentos não há amostra. */
export function averageTicket(receivedCents: number, bookings: number): number | null {
  if (bookings < MIN_TICKET_SAMPLE || receivedCents <= 0) return null
  return Math.round(receivedCents / bookings)
}

export function buildMovements(input: {
  tz: string
  range: { de: string; ate: string }
  payments: PaymentDetail[]
  refunds: RefundDetail[]
  payouts: PayoutRow[]
  expenses: ExpenseRow[]
}): Movement[] {
  const { tz, range } = input
  const who = (b: PaymentDetail["bookings"]) => (b ? `${b.cliente_nome} · ${b.servico_nome}` : "Atendimento")
  const out: Movement[] = []
  for (const p of input.payments) {
    if (p.confirmado_em !== null) {
      if (inRange(localDate(p.confirmado_em, tz), range)) out.push({ id: `p-${p.id}`, at: p.confirmado_em, descricao: who(p.bookings), kind: "recebimento", cents: p.valor_centavos, status: "Confirmado" })
    } else if (inRange(localDate(p.criado_em, tz), range)) {
      out.push({ id: `p-${p.id}`, at: p.criado_em, descricao: who(p.bookings), kind: "recebimento", cents: p.valor_centavos, status: "A confirmar" })
    }
  }
  for (const r of refundsIn(input.refunds, range, tz)) out.push({ id: `r-${r.id}`, at: r.criado_em, descricao: who(r.payments?.bookings ?? null), kind: "estorno", cents: -r.valor_centavos, status: "Estornado" })
  for (const x of input.payouts) if (inRange(localDate(x.criado_em, tz), range)) out.push({ id: `o-${x.id}`, at: x.criado_em, descricao: `Repasse a ${x.professionals?.nome ?? "profissional"}`, kind: "repasse", cents: -x.valor_centavos, status: "Repassado" })
  for (const e of input.expenses) out.push({ id: `e-${e.id}`, at: `${e.data}T12:00:00`, descricao: `${e.descricao} (${e.categoria})`, kind: "custo", cents: -e.valor_centavos, status: "Lançado" })
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

export const MOVEMENT_LABEL: Record<MovementKind, string> = { recebimento: "Pagamento", estorno: "Estorno", repasse: "Repasse", custo: "Custo" }

/** "2026-01" → "2025-12". */
export function previousMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`
}

export type Delta = { text: string; direction: "up" | "down" | "flat" | "new" }

/** Variação sobre o mês anterior. Sem base (mês anterior zerado) não existe percentual: "novo" quando já há valor, "0%" quando não há. */
export function delta(current: number, previous: number): Delta {
  if (previous === 0) return current === 0 ? { text: "0%", direction: "flat" } : { text: "novo", direction: "new" }
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100)
  return { text: `${pct > 0 ? "+" : ""}${pct}%`, direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat" }
}

/** Escala "bonita" do eixo Y: `steps` intervalos de 1, 2, 2,5, 5 ou 10 × potência de dez (valores em centavos). */
export function niceScale(maxCents: number, steps = 5): { top: number; ticks: number[] } {
  const raw = Math.max(maxCents, 100) / 100 / steps
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  const stepCents = Math.round((f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow * 100)
  return { top: stepCents * steps, ticks: Array.from({ length: steps + 1 }, (_, i) => i * stepCents) }
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
/** "2026-11-09" → "09 nov". */
export const dayMonth = (date: string) => `${date.slice(8)} ${MONTHS[Number(date.slice(5, 7)) - 1]}`

/** Receita confirmada (bruta) por serviço no período. */
export function revenueByService(payments: PaymentDetail[]): Share[] {
  return sumByKey(payments.map((p) => ({ key: p.bookings?.servico_nome ?? "Sem serviço", cents: p.valor_centavos })))
}

export type ProfessionalTotals = { id: string; nome: string; avatar: string | null | undefined; pendente: number; repassado: number }

/** Comissões (menos as canceladas) somadas por profissional: a repassar e já repassado. */
export function commissionsByProfessional(commissions: CommissionRow[]): ProfessionalTotals[] {
  const map = new Map<string, ProfessionalTotals>()
  for (const c of commissions) {
    if (c.status === "cancelada") continue
    const cur = map.get(c.professional_id) ?? { id: c.professional_id, nome: c.professionals?.nome ?? "Profissional", avatar: c.professionals?.avatar_path, pendente: 0, repassado: 0 }
    if (c.status === "provisionada") cur.pendente += c.valor_centavos
    else cur.repassado += c.valor_centavos
    map.set(c.professional_id, cur)
  }
  return [...map.values()].sort((a, b) => b.pendente - a.pendente || a.nome.localeCompare(b.nome, "pt-BR"))
}
