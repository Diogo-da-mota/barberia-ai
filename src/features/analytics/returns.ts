import { localDate } from "@/features/booking/domain"
import { phoneDigits } from "@/lib/br"

/**
 * Frequência de retorno: de quantos em quantos dias o cliente volta. Só atendimentos CONCLUÍDOS, pela data no fuso da
 * barbearia. Visitas no mesmo dia contam como uma (nunca "retorno em zero dias"). A média geral é a média das médias
 * individuais, para o cliente muito frequente não distorcer. É intervalo entre visitas, não duração de atendimento.
 */

export type Visit = { customer_id: string | null; cliente_nome: string; cliente_whatsapp: string; service_id: string | null; servico_nome: string; inicio: string }

/** Menos clientes que isso não formam uma média: a tela mostra "Sem dados suficientes". */
export const MIN_RETURN_CLIENTS = 3

export type ClientReturn = {
  key: string
  nome: string
  /** Dias distintos com atendimento concluído. */
  visitas: number
  /** Intervalo habitual (média entre visitas consecutivas), em dias. Null com uma única visita. */
  media: number | null
  ultimo: string
  diasDesde: number
  /** Já passou mais tempo desde a última visita do que o intervalo habitual. */
  atrasado: boolean
}
export type ServiceReturn = { key: string; nome: string; /** Null sem clientes suficientes. */ media: number | null; clientes: number }
export type ReturnAnalysis = {
  /** Data do atendimento concluído mais antigo considerado. */
  desde: string | null
  recorrentes: number
  unicos: number
  atrasados: number
  mediaGeral: number | null
  clientes: ClientReturn[]
  servicos: ServiceReturn[]
}

const dayNumber = (date: string) => {
  const [y, m, d] = date.split("-").map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}
const mean = (values: number[]) => values.reduce((t, v) => t + v, 0) / values.length

/** Média dos intervalos entre dias consecutivos distintos; null com menos de dois dias. */
function meanInterval(days: Set<string>): number | null {
  if (days.size < 2) return null
  const sorted = [...days].sort()
  return mean(sorted.slice(1).map((d, i) => dayNumber(d) - dayNumber(sorted[i])))
}

/**
 * Um cliente = a conta vinculada; reserva sem conta agrupa pelo WhatsApp normalizado e, quando esse número pertence a uma
 * única conta, junta-se a ela (mesma pessoa, sem duplicar). Sem conta e sem número não há como identificar: fica de fora.
 */
function clientKeys(visits: Visit[]): (string | null)[] {
  const accounts = new Map<string, Set<string>>()
  for (const v of visits) {
    const phone = phoneDigits(v.cliente_whatsapp ?? "")
    if (v.customer_id && phone) accounts.set(phone, (accounts.get(phone) ?? new Set()).add(v.customer_id))
  }
  return visits.map((v) => {
    if (v.customer_id) return v.customer_id
    const phone = phoneDigits(v.cliente_whatsapp ?? "")
    if (!phone) return null
    const owners = accounts.get(phone)
    return owners?.size === 1 ? [...owners][0] : `tel:${phone}`
  })
}

export function analyzeReturns(visits: Visit[], tz: string, today: string, catalog: { id: string; nome: string; ativo: boolean }[] = []): ReturnAnalysis {
  const keys = clientKeys(visits)
  const clients = new Map<string, { nome: string; ultimoInicio: string; days: Set<string>; services: Map<string, Set<string>> }>()
  const names = new Map(catalog.map((s) => [s.id, s.nome]))
  const serviceNames = new Map<string, string>(catalog.filter((s) => s.ativo).map((s) => [s.id, s.nome]))
  let desde: string | null = null

  visits.forEach((v, i) => {
    const key = keys[i]
    if (!key) return
    const day = localDate(v.inicio, tz)
    if (!desde || day < desde) desde = day
    let c = clients.get(key)
    if (!c) {
      c = { nome: v.cliente_nome, ultimoInicio: v.inicio, days: new Set(), services: new Map() }
      clients.set(key, c)
    }
    if (v.inicio >= c.ultimoInicio) { c.ultimoInicio = v.inicio; c.nome = v.cliente_nome } // vale o nome da visita mais recente
    c.days.add(day)
    const service = v.service_id ?? `nome:${v.servico_nome}`
    if (!serviceNames.has(service)) serviceNames.set(service, names.get(service) ?? v.servico_nome)
    c.services.set(service, (c.services.get(service) ?? new Set()).add(day))
  })

  const list: ClientReturn[] = [...clients].map(([key, c]) => {
    const media = meanInterval(c.days)
    const ultimo = [...c.days].sort().pop()!
    const diasDesde = Math.max(0, dayNumber(today) - dayNumber(ultimo))
    return { key, nome: c.nome, visitas: c.days.size, media, ultimo, diasDesde, atrasado: media !== null && diasDesde > media }
  })
  const recurring = list.filter((c) => c.media !== null)

  const perService = new Map<string, number[]>()
  for (const c of clients.values()) {
    for (const [service, days] of c.services) {
      const media = meanInterval(days)
      if (media !== null) perService.set(service, [...(perService.get(service) ?? []), media])
    }
  }
  const servicos: ServiceReturn[] = [...serviceNames].map(([key, nome]) => {
    const means = perService.get(key) ?? []
    return { key, nome, clientes: means.length, media: means.length >= MIN_RETURN_CLIENTS ? mean(means) : null }
  }).sort((a, b) => (a.media ?? Infinity) - (b.media ?? Infinity) || b.clientes - a.clientes || a.nome.localeCompare(b.nome))

  return {
    desde,
    recorrentes: recurring.length,
    unicos: list.length - recurring.length,
    atrasados: recurring.filter((c) => c.atrasado).length,
    mediaGeral: recurring.length >= MIN_RETURN_CLIENTS ? mean(recurring.map((c) => c.media!)) : null,
    // quem mais passou do intervalo habitual primeiro
    clientes: recurring.sort((a, b) => (b.diasDesde - b.media!) - (a.diasDesde - a.media!) || a.nome.localeCompare(b.nome)),
    servicos,
  }
}
