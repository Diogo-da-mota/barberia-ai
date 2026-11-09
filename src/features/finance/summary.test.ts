import { describe, expect, it } from "vitest"
import type { ExpenseRow, PaymentDetail, PayoutRow, RefundDetail } from "./api"
import { averageTicket, buildMovements, dailySeries, daysOf, sumByKey, utcWindow } from "./summary"

const TZ = "America/Sao_Paulo"
const range = { de: "2026-11-01", ate: "2026-11-30" }
const booking = { cliente_nome: "João", servico_nome: "Corte", professionals: { nome: "Rafa" } }
const pay = (id: string, valor: number, confirmado: string | null, criado = "2026-11-02T15:00:00Z"): PaymentDetail =>
  ({ id, booking_id: `b-${id}`, valor_centavos: valor, forma: "pix", parcelas: 1, criado_em: criado, confirmado_em: confirmado, bookings: booking })
const refund = (id: string, valor: number, criado: string): RefundDetail => ({ id, payment_id: "1", valor_centavos: valor, motivo: null, criado_em: criado, payments: { forma: "pix", bookings: booking } })
const expense = (id: string, valor: number, data: string): ExpenseRow => ({ id, descricao: "Aluguel", categoria: "fixo", valor_centavos: valor, data })

describe("summary", () => {
  it("lista todos os dias do mês", () => {
    expect(daysOf(range)).toHaveLength(30)
    expect(daysOf({ de: "2028-02-01", ate: "2028-02-29" })).toHaveLength(29)
  })

  it("série diária: receita confirmada menos estornos e custos, pelo dia local da barbearia", () => {
    // 01:00 UTC de 02/11 ainda é 01/11 em São Paulo
    const days = dailySeries(range, TZ, [pay("1", 5000, "2026-11-02T01:00:00Z"), pay("2", 3000, null)], [refund("r", 1000, "2026-11-10T15:00:00Z")], [expense("e", 20000, "2026-11-05")])
    expect(days.find((d) => d.date === "2026-11-01")!.receita).toBe(5000)
    expect(days.find((d) => d.date === "2026-11-02")!.receita).toBe(0)
    expect(days.find((d) => d.date === "2026-11-10")!.receita).toBe(-1000)
    expect(days.find((d) => d.date === "2026-11-05")!.custo).toBe(20000)
    expect(days.reduce((t, d) => t + d.receita, 0)).toBe(4000) // pagamento a confirmar não entra
  })

  it("agrupa por chave, ordena e descarta zeros", () => {
    expect(sumByKey([{ key: "a", cents: 100 }, { key: "b", cents: 300 }, { key: "a", cents: 250 }, { key: "z", cents: 0 }])).toEqual([{ key: "b", cents: 300 }, { key: "a", cents: 350 }].sort((x, y) => y.cents - x.cents))
  })

  it("ticket médio só existe com ao menos 3 atendimentos pagos", () => {
    expect(averageTicket(10000, 2)).toBeNull()
    expect(averageTicket(0, 5)).toBeNull()
    expect(averageTicket(15000, 3)).toBe(5000)
  })

  it("movimentações: separa recebimento, estorno, repasse e custo, do mais recente ao mais antigo", () => {
    const payouts: PayoutRow[] = [{ id: "o", professional_id: "p", valor_centavos: 2000, criado_em: "2026-11-12T12:00:00Z", professionals: { nome: "Rafa" } }]
    const list = buildMovements({
      tz: TZ, range, payments: [pay("1", 5000, "2026-11-03T15:00:00Z"), pay("2", 3000, null, "2026-11-04T15:00:00Z")],
      refunds: [refund("r", 1000, "2026-11-10T15:00:00Z")], payouts, expenses: [expense("e", 20000, "2026-11-05")],
    })
    expect(list.map((m) => [m.kind, m.status, m.cents])).toEqual([
      ["repasse", "Repassado", -2000], ["estorno", "Estornado", -1000], ["custo", "Lançado", -20000], ["recebimento", "A confirmar", 3000], ["recebimento", "Confirmado", 5000],
    ])
  })

  it("janela UTC cobre o mês inteiro com folga de fuso", () => {
    expect(utcWindow(range)).toEqual({ from: "2026-10-31T00:00:00Z", to: "2026-12-02T00:00:00Z" })
  })
})

describe("variação e escala", () => {
  it("variação sobre o mês anterior sem inventar percentual quando não há base", async () => {
    const { delta, previousMonth, niceScale, dayMonth } = await import("./summary")
    expect(delta(0, 0)).toEqual({ text: "0%", direction: "flat" })
    expect(delta(10000, 0)).toEqual({ text: "novo", direction: "new" })
    expect(delta(15000, 10000)).toEqual({ text: "+50%", direction: "up" })
    expect(delta(5000, 10000)).toEqual({ text: "-50%", direction: "down" })
    expect(delta(-5000, -10000)).toEqual({ text: "+50%", direction: "up" })
    expect(previousMonth("2026-01")).toBe("2025-12")
    expect(previousMonth("2026-11")).toBe("2026-10")
    expect(dayMonth("2026-11-09")).toBe("09 nov")
    expect(niceScale(10000)).toEqual({ top: 10000, ticks: [0, 2000, 4000, 6000, 8000, 10000] })
    expect(niceScale(23000).top).toBe(25000)
    expect(niceScale(0).ticks).toHaveLength(6)
  })
})
