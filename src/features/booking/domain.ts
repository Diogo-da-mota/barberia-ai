import { validatePhone } from "@/lib/br"
export type PublicService = { id: string; nome: string; descricao: string | null; preco_centavos: number; duracao_min: number; imagem_path?: string | null; fotos?: string[] }
export type PublicProfessional = { id: string; nome: string; service_ids: string[]; avatar_path?: string | null }
export type PublicShopData = {
  id: string
  nome: string
  slug: string
  endereco: string | null
  telefone: string | null
  fuso: string
  descricao?: string | null
  cor_destaque?: string | null
  /** Modelo do site (migration 0011). Ausente = Urbano. */
  template?: string | null
  logo_path?: string | null
  capa_path?: string | null
  galeria?: string[]
  services: PublicService[]
  professionals: PublicProfessional[]
}
export type Slot = { prof_id: string; prof_nome: string; slot_inicio: string }
/** Linha da grade do dia (get_slot_grid): o horário de um profissional, livre ou ocupado. */
export type GridSlot = Slot & { livre: boolean }
/** Um horário na tela: livre para quem foi escolhido (ou para alguém, em "qualquer") e quem está livre nele. */
export type SlotTime = { inicio: string; livre: boolean; livres: Slot[] }

/**
 * Horários do profissional escolhido (null = qualquer). No reagendamento, também inclui vagas de outros profissionais.
 * Ocupado = sem vaga para o escolhido. `livres` diz quem pode atender naquele horário.
 */
export function slotTimes(grid: GridSlot[], professionalId: string | null, showAlternatives = false): SlotTime[] {
  const byTime = new Map<string, GridSlot[]>()
  for (const row of grid) byTime.set(row.slot_inicio, [...(byTime.get(row.slot_inicio) ?? []), row])
  return [...byTime].flatMap(([inicio, rows]) => {
    const mine = professionalId ? rows.filter((r) => r.prof_id === professionalId) : rows
    const livres = rows.filter((r) => r.livre).map(({ prof_id, prof_nome, slot_inicio }) => ({ prof_id, prof_nome, slot_inicio }))
    if (mine.length === 0 && !(showAlternatives && livres.length > 0)) return []
    return [{ inicio, livre: mine.some((r) => r.livre), livres }]
  })
}

/** Até `n` horários livres mais próximos de `inicio` (sugestão quando ninguém está livre no horário pedido). */
export function nearestFree(times: SlotTime[], inicio: string, n = 3): SlotTime[] {
  const alvo = new Date(inicio).getTime()
  return times.filter((t) => t.livre)
    .sort((a, b) => Math.abs(new Date(a.inicio).getTime() - alvo) - Math.abs(new Date(b.inicio).getTime() - alvo))
    .slice(0, n)
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
}

export type BookingStatus = "pendente" | "confirmado" | "concluido" | "cancelado" | "nao_compareceu"
export type BookingRow = {
  id: string
  barbershop_id: string
  professional_id: string
  /** Nulo na reserva feita pela barbearia para cliente sem conta (0022). */
  customer_id: string | null
  service_id: string | null
  servico_nome: string
  preco_centavos: number
  duracao_min: number
  inicio: string
  fim: string
  status: BookingStatus
  cliente_nome: string
  cliente_whatsapp: string
  professionals: { nome: string; avatar_path?: string | null } | null
  barbershops?: { nome: string; fuso: string; slug: string } | null
}

export const STATUS_LABEL: Record<BookingStatus, string> = {
  pendente: "Pendente",
  confirmado: "Confirmado",
  concluido: "Concluído",
  cancelado: "Cancelado",
  nao_compareceu: "Não compareceu",
}

/** Lê os limites de um tstzrange devolvido pelo PostgREST: ["2026-11-07 13:00:00+00","2026-11-07 14:00:00+00") */
export function parseRange(range: string): { inicio: string; fim: string } {
  const m = /^[[(]"?([^",]+)"?,"?([^")\]]+)/.exec(range)
  if (!m) throw new Error("periodo inválido")
  const iso = (v: string) => new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString()
  return { inicio: iso(m[1]), fim: iso(m[2]) }
}

/** Tabela ou função ainda ausente no banco (migration não aplicada): não é um erro do usuário. */
export function isMissingSchema(error: unknown): boolean {
  const { code } = (error ?? {}) as { code?: string }
  return code === "PGRST205" || code === "PGRST202"
}

export const isActive = (status: BookingStatus) => status === "pendente" || status === "confirmado"
export const canReschedule = (booking: Pick<BookingRow, "status" | "service_id" | "inicio">) =>
  isActive(booking.status) && Boolean(booking.service_id) && Date.parse(booking.inicio) > Date.now()

// ---------- Datas no fuso da barbearia (instantes ficam em UTC; a tela converte) ----------

const parts = (ts: number, tz: string) => {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
  return Object.fromEntries(f.formatToParts(new Date(ts)).map((p) => [p.type, p.value]))
}

/** Data (AAAA-MM-DD) de um instante no fuso informado. */
export function localDate(iso: string | Date, tz: string): string {
  const p = parts(new Date(iso).getTime(), tz)
  return `${p.year}-${p.month}-${p.day}`
}

export const todayIn = (tz: string) => localDate(new Date(), tz)

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Segunda-feira da semana de uma data (AAAA-MM-DD). */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDays(date, -((dow + 6) % 7))
}

/** Primeiro dia do mês, n meses à frente (ou atrás). */
export function addMonths(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10)
}

export function formatMonth(date: string): string {
  const [y, m] = date.split("-").map(Number)
  const text = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)))
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Dias do mês da data, com vazios antes do dia 1 para a semana começar na segunda. */
export function monthGrid(date: string): (string | null)[] {
  const first = addMonths(date, 0)
  const [y, m] = first.split("-").map(Number)
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return [...Array<null>(lead).fill(null), ...Array.from({ length: total }, (_, i) => addDays(first, i))]
}

export function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
}

export function formatDay(date: string, style: "curto" | "longo" = "longo"): string {
  const [y, m, d] = date.split("-").map(Number)
  const options: Intl.DateTimeFormatOptions =
    style === "curto" ? { weekday: "short", day: "numeric" } : { weekday: "long", day: "numeric", month: "long" }
  const text = new Intl.DateTimeFormat("pt-BR", { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)))
  return text.charAt(0).toUpperCase() + text.slice(1).replace(".", "")
}

export function formatDateTime(iso: string, tz: string): string {
  return `${formatDay(localDate(iso, tz))}, ${formatTime(iso, tz)}`
}

/** Converte "AAAA-MM-DDTHH:mm" digitado no fuso da barbearia em um instante UTC (ISO). */
export function zonedToUtc(local: string, tz: string): string {
  const [d, t] = local.split("T")
  const [y, m, dd] = d.split("-").map(Number)
  const [hh, mm] = t.split(":").map(Number)
  const asUtc = Date.UTC(y, m - 1, dd, hh, mm)
  const offset = (ts: number) => {
    const p = parts(ts, tz)
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts
  }
  let ts = asUtc - offset(asUtc)
  const second = offset(ts)
  if (second !== offset(asUtc)) ts = asUtc - second
  return new Date(ts).toISOString()
}

// ---------- Validação e mensagens ----------

export function validateContact({ nome, whatsapp }: { nome: string; whatsapp: string }): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!nome.trim()) errors.nome = "Informe seu nome."
  else if (nome.trim().length > 120) errors.nome = "Use até 120 caracteres."
  if (!whatsapp.trim() || !validatePhone(whatsapp)) errors.whatsapp = "Informe o WhatsApp com DDD, como +55 11 91234-5678."
  return errors
}

const MESSAGES: Record<string, string> = {
  slot_taken: "Este horário acabou de ser ocupado. Escolha outro.",
  booking_limit: "Você já tem 3 reservas futuras ativas nesta barbearia.",
  booking_rate_limited: "Você fez muitas reservas nas últimas 24 horas. Tente novamente mais tarde ou fale com a barbearia.",
  manual_booking_limit: "Esta barbearia chegou ao limite de 300 reservas manuais em 24 horas. Tente novamente mais tarde.",
  cancel_window: "O prazo para cancelar já passou. Fale com a barbearia.",
  booking_started: "O horário desta reserva já começou. Fale com a barbearia.",
  invalid_contact: "Confira seu nome e seu WhatsApp.",
  invalid_professional: "Escolha o barbeiro.",
  invalid_service: "Este serviço não está disponível.",
  invalid_status: "Esta reserva não pode mais ser alterada.",
  already_linked: "Esta conta já está ligada a outro profissional.",
  invalid_profile: "Escolha uma conta de barbeiro desta barbearia.",
  invalid_invite: "Convite inválido, expirado ou já usado. Peça um novo link a quem convidou.",
  invite_wrong_email: "Este convite pertence a outra conta. Entre com a conta do e-mail convidado para continuar.",
  email_not_confirmed: "Confirme seu e-mail antes de aceitar o convite. Procure o link na sua caixa de entrada.",
  already_member: "Você já faz parte desta barbearia.",
  overlap: "Os intervalos de um mesmo dia não podem se sobrepor.",
  invalid_interval: "Confira os horários de início e fim.",
  plan_limit: "Você atingiu o limite de profissionais do seu plano. Desative alguém ou mude de plano.",
  subscription_inactive: "A assinatura desta barbearia está inativa. Regularize para voltar a usar este recurso.",
  shop_limit: "Cada proprietário pode ter até 3 barbearias.",
  forbidden: "Você não tem permissão para esta ação.",
  not_authenticated: "Entre na sua conta para continuar.",
  has_payments: "Esta reserva tem pagamento recebido. Estorne o pagamento antes de cancelar.",
  booking_not_payable: "Só reservas confirmadas ou concluídas recebem pagamento.",
}

/** Mensagem para o usuário a partir do erro do servidor, sem repassar detalhes internos. */
export function bookingErrorMessage(error: unknown): string {
  const { message, code } = (error ?? {}) as { message?: string; code?: string }
  const key = Object.keys(MESSAGES).find((k) => message === k)
  if (key) return MESSAGES[key]
  if (code === "23503") return "Há reservas ligadas a este item. Cancele-as primeiro."
  return "Não foi possível concluir. Tente novamente."
}

export type CustomerBooking = Pick<BookingRow, "customer_id" | "cliente_nome" | "cliente_whatsapp" | "inicio" | "status" | "preco_centavos"> & {
  servico_nome?: string
  /** Respostas dadas na reserva: avisos e lembretes / novidades e promoções. */
  consent_lembretes?: boolean
  consent_marketing?: boolean
  criado_em?: string
}
export type Customer = {
  id: string
  nome: string
  whatsapp: string
  /** Reservas ativas (sem as canceladas). */
  total: number
  /** Confirmadas (ainda marcadas ou já concluídas). */
  confirmados: number
  concluidos: number
  cancelados: number
  faltas: number
  gasto: number
  ultimo: string | null
  proxima: string | null
  proximaServico: string | null
  /** Resposta mais recente à pergunta "avisos e lembretes" (null = reservas antigas sem a resposta). */
  avisos: boolean | null
  /** Resposta mais recente à pergunta "novidades e promoções" na reserva (o consentimento vigente vem de customer_consents). */
  novidades: boolean | null
}

/** Clientes derivados das reservas (sem tabela própria): histórico, cancelamentos, faltas, próximo agendamento e total gasto. */
export function aggregateCustomers(rows: CustomerBooking[], now = new Date()): Customer[] {
  const map = new Map<string, Customer>()
  const answeredAt = new Map<string, string>()
  for (const row of [...rows].sort((a, b) => b.inicio.localeCompare(a.inicio))) {
    // cliente com conta agrupa pela conta; reserva da barbearia sem conta agrupa pelo WhatsApp
    const key = row.customer_id ?? `tel:${row.cliente_whatsapp}`
    const current = map.get(key) ?? {
      id: key, nome: row.cliente_nome, whatsapp: row.cliente_whatsapp, total: 0, confirmados: 0, concluidos: 0, cancelados: 0, faltas: 0, gasto: 0,
      ultimo: null, proxima: null, proximaServico: null, avisos: null, novidades: null,
    }
    // a resposta aos termos vale a da reserva mais recente (pela data em que foi feita)
    if (row.consent_lembretes !== undefined) {
      const when = row.criado_em ?? row.inicio
      if (!answeredAt.has(key) || when > answeredAt.get(key)!) {
        answeredAt.set(key, when)
        current.avisos = row.consent_lembretes
        current.novidades = row.consent_marketing ?? null
      }
    }
    if (row.status === "cancelado") {
      current.cancelados += 1
      map.set(key, current)
      continue
    }
    current.total += 1
    if (row.status === "confirmado" || row.status === "concluido") current.confirmados += 1
    if (row.status === "concluido") {
      current.concluidos += 1
      current.gasto += row.preco_centavos
      current.ultimo = current.ultimo ?? row.inicio
    }
    if (row.status === "nao_compareceu") current.faltas += 1
    if (isActive(row.status) && new Date(row.inicio) >= now && (!current.proxima || row.inicio < current.proxima)) {
      current.proxima = row.inicio
      current.proximaServico = row.servico_nome ?? null
    }
    map.set(key, current)
  }
  return [...map.values()].sort((a, b) => (b.ultimo ?? "").localeCompare(a.ultimo ?? "") || a.nome.localeCompare(b.nome))
}

export type HoursRow = { professional_id: string; dow: number; inicio_min: number; fim_min: number }

/**
 * Ocupação dos próximos 7 dias: minutos reservados ÷ minutos de jornada de toda a equipe.
 * Devolve null quando não há jornada cadastrada (não inventa percentual).
 */
export function computeOccupancy(rows: BookingRow[], hours: HoursRow[], tz: string, now = new Date()): number | null {
  const today = localDate(now, tz)
  const end = addDays(today, 7)
  let available = 0
  for (let i = 0; i < 7; i++) {
    const [y, m, d] = addDays(today, i).split("-").map(Number)
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
    for (const h of hours) if (h.dow === dow) available += h.fim_min - h.inicio_min
  }
  if (available === 0) return null
  const booked = rows
    .filter((r) => r.status !== "cancelado" && localDate(r.inicio, tz) >= today && localDate(r.inicio, tz) < end)
    .reduce((sum, r) => sum + r.duracao_min, 0)
  return Math.min(100, Math.round((booked / available) * 100))
}

/** Indicadores do painel a partir de dados reais; devolve null quando não há reservas. */
export function computeStats(rows: BookingRow[], tz: string, now = new Date()) {
  if (rows.length === 0) return null
  const today = localDate(now, tz)
  const weekEnd = addDays(today, 7)
  const counted = rows.filter((r) => r.status !== "cancelado")
  const inDay = (r: BookingRow) => localDate(r.inicio, tz)
  const done = rows.filter((r) => r.status === "concluido").length
  const missed = rows.filter((r) => r.status === "nao_compareceu").length
  return {
    today: counted.filter((r) => inDay(r) === today).length,
    week: counted.filter((r) => inDay(r) > today && inDay(r) <= weekEnd).length,
    attendance: done + missed > 0 ? Math.round((done / (done + missed)) * 100) : null,
  }
}
