import { addDays, formatTime, localDate, weekStart, type BookingStatus, type HoursRow } from "@/features/booking/domain"
import { dayMonth, daysOf, inRange } from "@/features/finance/summary"

/**
 * Análises da barbearia: só agrupamento de registros reais (reservas, pagamentos confirmados, estornos e jornada).
 * Nada é estimado. Agendamento ≠ atendimento: "realizado" é só a reserva com status `concluido`; receita é só pagamento
 * CONFIRMADO menos estornos. Amostra pequena devolve null e a tela mostra "Sem dados suficientes".
 */

export type Range = { de: string; ate: string }
export type AnalyticsBooking = {
  id: string
  professional_id: string
  service_id: string | null
  servico_nome: string
  duracao_min: number
  inicio: string
  status: BookingStatus
  professionals: { nome: string; avatar_path?: string | null } | null
}
type PaidBooking = { service_id: string | null; servico_nome: string } | null
export type AnalyticsPayment = { valor_centavos: number; confirmado_em: string | null; bookings: PaidBooking }
export type AnalyticsRefund = { valor_centavos: number; criado_em: string; payments: { bookings: PaidBooking } | null }

/** Menos registros que isso não sustentam "melhor dia", "horário de pico" nem percentual. */
export const MIN_SAMPLE = 5

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]

const dowOf = (date: string) => {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Últimos n dias terminando hoje (hoje incluído). */
export const lastDays = (today: string, n: number): Range => ({ de: addDays(today, -(n - 1)), ate: today })

/** Período de mesmo tamanho imediatamente anterior. */
export function previousRange(range: Range): Range {
  const size = daysOf(range).length
  return { de: addDays(range.de, -size), ate: addDays(range.de, -1) }
}

/** Reservas cujo horário marcado cai no período (data no fuso da barbearia). */
export const bookingsIn = (rows: AnalyticsBooking[], range: Range, tz: string) => rows.filter((r) => inRange(localDate(r.inicio, tz), range))

export type Totals = { agendados: number; realizados: number; cancelados: number; faltas: number; emAberto: number; comparecimento: number | null }

/** Contagem por desfecho. Comparecimento = realizados ÷ (realizados + faltas); sem amostra mínima, null. */
export function totals(rows: AnalyticsBooking[]): Totals {
  const count = (s: BookingStatus) => rows.filter((r) => r.status === s).length
  const realizados = count("concluido")
  const faltas = count("nao_compareceu")
  const cancelados = count("cancelado")
  return {
    agendados: rows.length,
    realizados,
    cancelados,
    faltas,
    emAberto: rows.length - realizados - faltas - cancelados,
    comparecimento: realizados + faltas >= MIN_SAMPLE ? Math.round((realizados / (realizados + faltas)) * 100) : null,
  }
}

/** Receita confirmada no período: pagamentos confirmados (data da confirmação) menos estornos (data do estorno). */
export function confirmedRevenue(payments: AnalyticsPayment[], refunds: AnalyticsRefund[], range: Range, tz: string) {
  const paid = payments.filter((p) => p.confirmado_em !== null && inRange(localDate(p.confirmado_em, tz), range))
  const back = refunds.filter((r) => inRange(localDate(r.criado_em, tz), range))
  return { paid, back, total: paid.reduce((t, p) => t + p.valor_centavos, 0) - back.reduce((t, r) => t + r.valor_centavos, 0) }
}

export type WeekdayPoint = { dow: number; label: string; total: number; dias: number; media: number }

/** Atendimentos realizados por dia da semana, com quantas vezes cada dia ocorreu no período (a média é por ocorrência). */
export function byWeekday(rows: AnalyticsBooking[], range: Range, tz: string): WeekdayPoint[] {
  const points = WEEKDAYS.map((label, dow) => ({ dow, label, total: 0, dias: 0, media: 0 }))
  for (const day of daysOf(range)) points[dowOf(day)].dias += 1
  for (const r of rows) if (r.status === "concluido") points[dowOf(localDate(r.inicio, tz))].total += 1
  for (const p of points) p.media = p.dias > 0 ? p.total / p.dias : 0
  return [...points.slice(1), points[0]] // semana começa na segunda
}

/**
 * Dia mais forte e mais fraco pela média por ocorrência. O mais fraco só considera dias em que a barbearia abre
 * (jornada cadastrada); sem jornada, os dias que tiveram algum atendimento. Sem amostra ou sem diferença: null.
 */
export function weekdayExtremes(points: WeekdayPoint[], openDows: Set<number>): { best: WeekdayPoint; worst: WeekdayPoint | null } | null {
  if (points.reduce((t, p) => t + p.total, 0) < MIN_SAMPLE) return null
  const present = points.filter((p) => p.dias > 0)
  const best = [...present].sort((a, b) => b.media - a.media)[0]
  const open = present.filter((p) => (openDows.size > 0 ? openDows.has(p.dow) : p.total > 0))
  const worst = [...open].sort((a, b) => a.media - b.media)[0]
  return { best, worst: worst && worst.dow !== best.dow && worst.media < best.media ? worst : null }
}

export type HourPoint = { hora: number; label: string; total: number }

/** Agendamentos (sem os cancelados) pela hora de início, da primeira à última hora com registro. */
export function byHour(rows: AnalyticsBooking[], tz: string): HourPoint[] {
  const counts = new Map<number, number>()
  for (const r of rows) {
    if (r.status === "cancelado") continue
    const hora = Number(formatTime(r.inicio, tz).slice(0, 2))
    counts.set(hora, (counts.get(hora) ?? 0) + 1)
  }
  if (counts.size === 0) return []
  const hours = [...counts.keys()]
  const out: HourPoint[] = []
  for (let h = Math.min(...hours); h <= Math.max(...hours); h++) out.push({ hora: h, label: `${String(h).padStart(2, "0")}h`, total: counts.get(h) ?? 0 })
  return out
}

/** Hora com mais agendamentos; sem amostra mínima, null. */
export function peakHour(points: HourPoint[]): HourPoint | null {
  if (points.reduce((t, p) => t + p.total, 0) < MIN_SAMPLE) return null
  return [...points].sort((a, b) => b.total - a.total)[0] ?? null
}

export type Grain = "dia" | "semana" | "mes"
export type SeriesPoint = { key: string; label: string; total: number }

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
const bucketOf = (date: string, grain: Grain) => (grain === "dia" ? date : grain === "semana" ? weekStart(date) : date.slice(0, 7))
const bucketLabel = (key: string, grain: Grain) => (grain === "mes" ? `${MONTHS[Number(key.slice(5, 7)) - 1]}/${key.slice(2, 4)}` : dayMonth(key))

/** Atendimentos realizados por dia, semana (começando na segunda) ou mês; períodos sem atendimento aparecem com zero. */
export function series(rows: AnalyticsBooking[], range: Range, tz: string, grain: Grain): SeriesPoint[] {
  const map = new Map<string, SeriesPoint>()
  for (const day of daysOf(range)) {
    const key = bucketOf(day, grain)
    if (!map.has(key)) map.set(key, { key, label: bucketLabel(key, grain), total: 0 })
  }
  for (const r of rows) if (r.status === "concluido") map.get(bucketOf(localDate(r.inicio, tz), grain))!.total += 1
  return [...map.values()]
}

export type ProfessionalStats = {
  id: string
  nome: string
  avatar: string | null | undefined
  agendados: number
  realizados: number
  cancelados: number
  faltas: number
  /** Serviço que mais realizou no período. */
  topServico: { nome: string; total: number } | null
  /** Minutos reservados (sem cancelados) ÷ minutos da jornada cadastrada no período. Sem jornada: null. */
  ocupacao: number | null
}

export function byProfessional(rows: AnalyticsBooking[], hours: HoursRow[], range: Range): ProfessionalStats[] {
  const dayCount = new Array<number>(7).fill(0)
  for (const day of daysOf(range)) dayCount[dowOf(day)] += 1
  const available = new Map<string, number>()
  for (const h of hours) available.set(h.professional_id, (available.get(h.professional_id) ?? 0) + (h.fim_min - h.inicio_min) * dayCount[h.dow])

  const map = new Map<string, ProfessionalStats & { minutos: number; servicos: Map<string, number> }>()
  for (const r of rows) {
    let p = map.get(r.professional_id)
    if (!p) {
      p = { id: r.professional_id, nome: r.professionals?.nome ?? "Profissional removido", avatar: r.professionals?.avatar_path, agendados: 0, realizados: 0, cancelados: 0, faltas: 0, topServico: null, ocupacao: null, minutos: 0, servicos: new Map() }
      map.set(r.professional_id, p)
    }
    p.agendados += 1
    if (r.status === "cancelado") p.cancelados += 1
    else p.minutos += r.duracao_min
    if (r.status === "nao_compareceu") p.faltas += 1
    if (r.status === "concluido") {
      p.realizados += 1
      p.servicos.set(r.servico_nome, (p.servicos.get(r.servico_nome) ?? 0) + 1)
    }
  }
  return [...map.values()]
    .map(({ minutos, servicos, ...p }) => {
      const top = [...servicos].sort((a, b) => b[1] - a[1])[0]
      const total = available.get(p.id) ?? 0
      return { ...p, topServico: top ? { nome: top[0], total: top[1] } : null, ocupacao: total > 0 ? Math.min(100, Math.round((minutos / total) * 100)) : null }
    })
    .sort((a, b) => b.realizados - a.realizados || b.agendados - a.agendados || a.nome.localeCompare(b.nome))
}

export type ServiceStats = { key: string; nome: string; agendados: number; realizados: number; receita: number }

const serviceKey = (b: { service_id: string | null; servico_nome: string }) => b.service_id ?? `nome:${b.servico_nome}`

/**
 * Por serviço: agendados (todas as reservas do período), realizados (concluídos) e receita confirmada líquida.
 * Serviços ativos do cadastro sem nenhuma reserva entram com zero (menor procura). O nome é o do cadastro atual quando existe.
 */
export function byService(
  rows: AnalyticsBooking[],
  revenue: Pick<ReturnType<typeof confirmedRevenue>, "paid" | "back">,
  catalog: { id: string; nome: string; ativo: boolean }[],
): ServiceStats[] {
  const names = new Map(catalog.map((s) => [s.id, s.nome]))
  const map = new Map<string, ServiceStats>()
  const get = (b: { service_id: string | null; servico_nome: string }) => {
    const key = serviceKey(b)
    let s = map.get(key)
    if (!s) {
      s = { key, nome: names.get(key) ?? b.servico_nome, agendados: 0, realizados: 0, receita: 0 }
      map.set(key, s)
    }
    return s
  }
  for (const s of catalog) if (s.ativo) get({ service_id: s.id, servico_nome: s.nome })
  for (const r of rows) {
    const s = get(r)
    s.agendados += 1
    if (r.status === "concluido") s.realizados += 1
  }
  for (const p of revenue.paid) if (p.bookings) get(p.bookings).receita += p.valor_centavos
  for (const r of revenue.back) if (r.payments?.bookings) get(r.payments.bookings).receita -= r.valor_centavos
  return [...map.values()].sort((a, b) => b.agendados - a.agendados || b.realizados - a.realizados || a.nome.localeCompare(b.nome))
}

/** Serviços ativos com menos procura que os demais: os que ficaram no menor número de agendamentos, se houver diferença para o topo. */
export function leastWanted(stats: ServiceStats[], catalog: { id: string; ativo: boolean }[]): ServiceStats[] {
  const active = new Set(catalog.filter((s) => s.ativo).map((s) => s.id))
  const list = stats.filter((s) => active.has(s.key))
  if (list.length < 2 || list.reduce((t, s) => t + s.agendados, 0) < MIN_SAMPLE) return []
  const min = Math.min(...list.map((s) => s.agendados))
  const max = Math.max(...list.map((s) => s.agendados))
  return min < max ? list.filter((s) => s.agendados === min) : []
}
