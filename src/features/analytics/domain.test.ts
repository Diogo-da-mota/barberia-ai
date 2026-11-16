// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { BookingStatus } from "@/features/booking/domain"
import {
  bookingsIn, byHour, byProfessional, byService, byWeekday, confirmedRevenue, lastDays, leastWanted, peakHour, previousRange, series, totals, weekdayExtremes,
  type AnalyticsBooking,
} from "./domain"

const TZ = "America/Sao_Paulo"
let seq = 0
/** Reserva às `hora` (horário de Brasília) do dia informado. */
const booking = (dia: string, hora: number, status: BookingStatus, over: Partial<AnalyticsBooking> = {}): AnalyticsBooking => ({
  id: `b${++seq}`, professional_id: "p1", service_id: "s1", servico_nome: "Corte", duracao_min: 30,
  inicio: new Date(`${dia}T${String(hora).padStart(2, "0")}:00:00-03:00`).toISOString(), status,
  professionals: { nome: "Carlos" }, ...over,
})
const many = (n: number, make: () => AnalyticsBooking) => Array.from({ length: n }, make)

describe("período", () => {
  it("últimos 7 dias incluem hoje e o período anterior tem o mesmo tamanho, sem sobrepor", () => {
    const range = lastDays("2026-11-16", 7)
    expect(range).toEqual({ de: "2026-11-10", ate: "2026-11-16" })
    expect(previousRange(range)).toEqual({ de: "2026-11-03", ate: "2026-11-09" })
  })

  it("a reserva entra pelo dia no fuso da barbearia, não em UTC", () => {
    const late = booking("2026-11-09", 22, "concluido") // 01:00 UTC do dia 10
    expect(bookingsIn([late], { de: "2026-11-10", ate: "2026-11-16" }, TZ)).toHaveLength(0)
    expect(bookingsIn([late], { de: "2026-11-03", ate: "2026-11-09" }, TZ)).toHaveLength(1)
  })
})

describe("agendamento não é atendimento", () => {
  const rows = [
    ...many(6, () => booking("2026-11-10", 10, "concluido")),
    ...many(2, () => booking("2026-11-10", 11, "nao_compareceu")),
    booking("2026-11-11", 9, "cancelado"), booking("2026-11-16", 18, "confirmado"),
  ]

  it("realizado é só o concluído; confirmado e pendente ficam sem desfecho", () => {
    expect(totals(rows)).toEqual({ agendados: 10, realizados: 6, cancelados: 1, faltas: 2, emAberto: 1, comparecimento: 75 })
  })

  it("sem amostra mínima não há percentual de comparecimento", () => {
    expect(totals([booking("2026-11-10", 10, "concluido"), booking("2026-11-10", 11, "nao_compareceu")]).comparecimento).toBeNull()
  })
})

describe("receita confirmada", () => {
  const service = { service_id: "s1", servico_nome: "Corte" }
  const range = { de: "2026-11-10", ate: "2026-11-16" }

  it("ignora pagamento a confirmar e fora do período, e desconta estorno", () => {
    const revenue = confirmedRevenue(
      [
        { valor_centavos: 5000, confirmado_em: "2026-11-12T15:00:00Z", bookings: service },
        { valor_centavos: 9000, confirmado_em: null, bookings: service },
        { valor_centavos: 7000, confirmado_em: "2026-11-01T15:00:00Z", bookings: service },
      ],
      [{ valor_centavos: 1000, criado_em: "2026-11-13T15:00:00Z", payments: { bookings: service } }],
      range, TZ,
    )
    expect(revenue.total).toBe(4000)
    const stats = byService([booking("2026-11-12", 10, "concluido")], revenue, [{ id: "s1", nome: "Corte social", ativo: true }, { id: "s2", nome: "Barba", ativo: true }])
    expect(stats).toEqual([
      { key: "s1", nome: "Corte social", agendados: 1, realizados: 1, receita: 4000 },
      { key: "s2", nome: "Barba", agendados: 0, realizados: 0, receita: 0 },
    ])
  })
})

describe("movimento", () => {
  const range = { de: "2026-11-02", ate: "2026-11-15" } // duas semanas: cada dia ocorre 2 vezes
  const rows = [
    ...many(8, () => booking("2026-11-07", 10, "concluido")), // sábado
    ...many(2, () => booking("2026-11-03", 18, "concluido")), // terça
    ...many(3, () => booking("2026-11-03", 18, "cancelado")),
  ]

  it("conta só concluídos por dia da semana, começando na segunda, com a média por ocorrência", () => {
    const points = byWeekday(rows, range, TZ)
    expect(points.map((p) => p.label)[0]).toBe("Segunda")
    expect(points.find((p) => p.label === "Sábado")).toMatchObject({ total: 8, dias: 2, media: 4 })
    expect(points.find((p) => p.label === "Terça")).toMatchObject({ total: 2, media: 1 })
  })

  it("o dia mais fraco só considera os dias em que a barbearia abre", () => {
    const points = byWeekday(rows, range, TZ)
    const extremes = weekdayExtremes(points, new Set([2, 6]))
    expect(extremes?.best.label).toBe("Sábado")
    expect(extremes?.worst?.label).toBe("Terça") // domingo e os outros dias fechados não contam
    expect(weekdayExtremes(byWeekday(rows.slice(0, 3), range, TZ), new Set([2, 6]))).toBeNull()
  })

  it("horário de pico vem dos agendamentos sem os cancelados", () => {
    const hours = byHour(rows, TZ)
    expect(hours.map((h) => h.label)).toEqual(["10h", "11h", "12h", "13h", "14h", "15h", "16h", "17h", "18h"])
    expect(peakHour(hours)).toMatchObject({ label: "10h", total: 8 })
    expect(peakHour(byHour(rows.slice(0, 2), TZ))).toBeNull()
  })

  it("série por dia, semana e mês inclui os períodos zerados", () => {
    expect(series(rows, range, TZ, "dia")).toHaveLength(14)
    expect(series(rows, range, TZ, "semana").map((p) => p.total)).toEqual([10, 0])
    expect(series(rows, range, TZ, "mes")).toEqual([{ key: "2026-11", label: "nov/26", total: 10 }])
  })
})

describe("profissionais", () => {
  const range = { de: "2026-11-09", ate: "2026-11-15" } // uma semana
  const rows = [
    ...many(4, () => booking("2026-11-10", 10, "concluido")),
    booking("2026-11-10", 11, "concluido", { servico_nome: "Barba", service_id: "s2" }),
    booking("2026-11-11", 9, "cancelado"), booking("2026-11-11", 10, "nao_compareceu"),
    booking("2026-11-12", 9, "concluido", { professional_id: "p2", professionals: { nome: "Davi" } }),
  ]

  it("separa realizados, cancelados e faltas e aponta o serviço mais realizado", () => {
    const [carlos, davi] = byProfessional(rows, [{ professional_id: "p1", dow: 2, inicio_min: 540, fim_min: 1080 }], range)
    expect(carlos).toMatchObject({ nome: "Carlos", agendados: 7, realizados: 5, cancelados: 1, faltas: 1, topServico: { nome: "Corte", total: 4 } })
    expect(carlos.ocupacao).toBe(33) // 6 reservas não canceladas × 30 min ÷ 540 min de jornada (uma terça)
    expect(davi).toMatchObject({ nome: "Davi", realizados: 1, ocupacao: null }) // sem jornada cadastrada não há percentual
  })
})

describe("menor procura", () => {
  const catalog = [{ id: "s1", nome: "Corte", ativo: true }, { id: "s2", nome: "Barba", ativo: true }, { id: "s3", nome: "Antigo", ativo: false }]
  const empty = { paid: [], back: [] }

  it("aponta o serviço ativo menos agendado, só com amostra e diferença real", () => {
    const stats = byService(many(6, () => booking("2026-11-10", 10, "concluido")), empty, catalog)
    expect(leastWanted(stats, catalog).map((s) => s.nome)).toEqual(["Barba"])
    expect(leastWanted(byService([booking("2026-11-10", 10, "concluido")], empty, catalog), catalog)).toEqual([])
  })
})
