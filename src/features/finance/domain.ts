import { formatPrice } from "@/features/catalog/domain"

export type PaymentForm = "pix" | "dinheiro" | "debito" | "credito"
export type CommissionStatus = "provisionada" | "liquidada" | "cancelada"
export type RuleKind = "percentual" | "fixo"

export const PAYMENT_FORMS: { value: PaymentForm; label: string }[] = [
  { value: "pix", label: "PIX" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "debito", label: "Débito" },
  { value: "credito", label: "Crédito" },
]

export const paymentFormLabel = (form: string) => PAYMENT_FORMS.find((f) => f.value === form)?.label ?? form

export function formatCommissionStatus(status: CommissionStatus): string {
  return { provisionada: "A repassar", liquidada: "Repassada", cancelada: "Cancelada" }[status]
}

/** "60", "60,5", "1.250,00" ou "R$ 25,90" viram centavos inteiros. Zero, negativo ou fração de centavo: null. */
export function parseMoney(text: string): number | null {
  const clean = text.replace(/R\$/gi, "").replace(/\s/g, "")
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(clean)) return null
  const [int, frac = ""] = clean.replace(/\./g, "").split(",")
  const cents = Number(int) * 100 + Number(frac.padEnd(2, "0"))
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}

/** "40" → 4000 e "12,5" → 1250 (pontos-base). Aceita de 0 a 100 com até duas casas. */
export function parsePercent(text: string): number | null {
  const clean = text.replace("%", "").trim()
  if (!/^\d{1,3}(,\d{1,2})?$/.test(clean)) return null
  const [int, frac = ""] = clean.split(",")
  const bp = Number(int) * 100 + Number(frac.padEnd(2, "0"))
  return bp <= 10000 ? bp : null
}

export function describeRule(tipo: RuleKind, valor: number): string {
  if (tipo === "fixo") return `${formatPrice(valor)} fixo`
  return `${(valor / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
}

const MESSAGES: Record<string, string> = {
  overpayment: "O valor é maior que o valor ainda a receber deste atendimento.",
  over_refund: "O estorno é maior que o valor recebido neste pagamento.",
  commission_settled: "O repasse da comissão deste atendimento já foi feito; o estorno exige ajuste manual.",
  nothing_to_pay: "Não há comissões a repassar para este profissional.",
  booking_not_payable: "Só reservas confirmadas ou concluídas recebem pagamento.",
  has_payments: "Esta reserva tem pagamento registrado. Estorne (se confirmado) ou descarte (se a confirmar) antes de cancelar.",
  payment_not_confirmed: "Confirme o pagamento antes de estornar.",
  payment_confirmed: "Este pagamento já foi confirmado. Para desfazer, faça um estorno.",
  invalid_payment: "Confira o valor, a forma de pagamento e as parcelas.",
  invalid_refund: "Confira o valor do estorno.",
  invalid_rule: "Confira o tipo e o valor da regra de comissão.",
  invalid_expense: "Confira a descrição, a categoria, o valor e a data do custo.",
  invalid_period: "Confira as datas do período.",
  idempotency_conflict: "Esta operação já foi registrada com outros dados. Tente novamente.",
  forbidden: "Você não tem permissão para esta ação.",
}

export function financeErrorMessage(error: unknown): string {
  const { message } = (error ?? {}) as { message?: string }
  const key = Object.keys(MESSAGES).find((k) => message === k)
  return key ? MESSAGES[key] : "Não foi possível concluir. Tente novamente."
}

type PaymentLike = { valor_centavos: number; confirmado_em?: string | null }

/** Só `confirmado_em: null` é "a confirmar"; sem o campo (dados antigos) vale como confirmado. */
export const isConfirmed = (p: PaymentLike) => p.confirmado_em !== null

/** Total CONFIRMADO (já no caixa) menos estornos. O que está "a confirmar" não conta. */
export function confirmedTotal(payments: PaymentLike[], refunds: { valor_centavos: number }[]): number {
  const pago = payments.filter(isConfirmed).reduce((sum, p) => sum + p.valor_centavos, 0)
  return pago - refunds.reduce((sum, r) => sum + r.valor_centavos, 0)
}

/** Declarado e ainda não confirmado. */
export function pendingTotal(payments: PaymentLike[]): number {
  return payments.filter((p) => !isConfirmed(p)).reduce((sum, p) => sum + p.valor_centavos, 0)
}

/** Quanto ainda falta RECEBER (confirmar): preço menos o confirmado. */
export function remainingToReceive(precoCentavos: number, payments: PaymentLike[], refunds: { valor_centavos: number }[]): number {
  return Math.max(0, precoCentavos - confirmedTotal(payments, refunds))
}

/** Quanto ainda pode ser declarado (o banco limita confirmado + a confirmar ao preço). */
export function remainingToDeclare(precoCentavos: number, payments: PaymentLike[], refunds: { valor_centavos: number }[]): number {
  const todos = payments.reduce((sum, p) => sum + p.valor_centavos, 0) - refunds.reduce((sum, r) => sum + r.valor_centavos, 0)
  return Math.max(0, precoCentavos - todos)
}

/** Primeiro e último dia do mês corrente no fuso da barbearia (AAAA-MM-DD). */
export function monthRange(now: Date, tz: string): { de: string; ate: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(now)
  const year = Number(parts.find((p) => p.type === "year")!.value)
  const month = Number(parts.find((p) => p.type === "month")!.value)
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const mm = String(month).padStart(2, "0")
  return { de: `${year}-${mm}-01`, ate: `${year}-${mm}-${String(last).padStart(2, "0")}` }
}

/** "AAAA-MM" (campo month) vira primeiro e último dia do mês; texto inválido devolve null. */
export function rangeOfMonth(ym: string): { de: string; ate: string } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym)
  if (!m) return null
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate()
  return { de: `${m[1]}-${m[2]}-01`, ate: `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}` }
}

export const newKey = () => crypto.randomUUID()
