import { describe, expect, it } from "vitest"
import { formatPrice } from "@/features/catalog/domain"
import { describeRule, expenseTotals, expenseView, financeErrorMessage, formatCommissionStatus, monthRange, rangeOfMonth, parseMoney, parsePercent, paymentFormLabel, remainingToReceive } from "./domain"

describe("parseMoney", () => {
  it("converte texto em centavos inteiros", () => {
    expect(parseMoney("60")).toBe(6000)
    expect(parseMoney("60,5")).toBe(6050)
    expect(parseMoney("60,50")).toBe(6050)
    expect(parseMoney("1.250,00")).toBe(125000)
    expect(parseMoney("R$ 25,90")).toBe(2590)
    expect(parseMoney("0,01")).toBe(1)
  })
  it("recusa valores inválidos, zero, negativos e frações de centavo", () => {
    for (const bad of ["", "abc", "0", "0,00", "-5", "10,999", "1,2,3", "1e3"]) expect(parseMoney(bad)).toBeNull()
  })
})

describe("parsePercent", () => {
  it("devolve pontos-base de 0 a 10000", () => {
    expect(parsePercent("40")).toBe(4000)
    expect(parsePercent("12,5")).toBe(1250)
    expect(parsePercent("100")).toBe(10000)
    expect(parsePercent("0")).toBe(0)
  })
  it("recusa acima de 100%, negativos e texto", () => {
    for (const bad of ["100,01", "101", "-1", "x", "", "5,555"]) expect(parsePercent(bad)).toBeNull()
  })
})

describe("textos", () => {
  it("descreve regras de comissão", () => {
    expect(describeRule("percentual", 4000)).toBe("40%")
    expect(describeRule("percentual", 1250)).toBe("12,5%")
    expect(describeRule("fixo", 2500)).toBe(`${formatPrice(2500)} fixo`)
  })
  it("rotula formas de pagamento e estados de comissão", () => {
    expect(paymentFormLabel("pix")).toBe("PIX")
    expect(paymentFormLabel("credito")).toBe("Crédito")
    expect(formatCommissionStatus("provisionada")).toBe("A repassar")
    expect(formatCommissionStatus("liquidada")).toBe("Repassada")
    expect(formatCommissionStatus("cancelada")).toBe("Cancelada")
  })
  it("traduz erros do servidor sem vazar detalhes", () => {
    expect(financeErrorMessage({ message: "overpayment" })).toMatch(/maior que o valor/)
    expect(financeErrorMessage({ message: "commission_settled" })).toMatch(/repasse/)
    expect(financeErrorMessage({ message: "nothing_to_pay" })).toMatch(/Não há comissões/)
    expect(financeErrorMessage({ message: "idempotency_conflict" })).toMatch(/Tente novamente/)
    expect(financeErrorMessage({ message: "relation \"payments\" does not exist" })).toBe("Não foi possível concluir. Tente novamente.")
  })
})

describe("saldo e período", () => {
  it("calcula o que falta receber de um atendimento", () => {
    expect(remainingToReceive(6000, [{ valor_centavos: 2000 }, { valor_centavos: 1000 }], [{ valor_centavos: 500 }])).toBe(3500)
    expect(remainingToReceive(6000, [], [])).toBe(6000)
    expect(remainingToReceive(6000, [{ valor_centavos: 6000 }], [])).toBe(0)
  })
  it("devolve o mês corrente no fuso da barbearia", () => {
    expect(monthRange(new Date("2026-11-06T12:00:00Z"), "America/Sao_Paulo")).toEqual({ de: "2026-11-01", ate: "2026-11-30" })
    expect(monthRange(new Date("2026-03-01T01:00:00Z"), "America/Sao_Paulo")).toEqual({ de: "2026-02-01", ate: "2026-02-28" }) // ainda é 28/02 em São Paulo
    expect(monthRange(new Date("2028-02-10T12:00:00Z"), "America/Sao_Paulo")).toEqual({ de: "2028-02-01", ate: "2028-02-29" })
  })
})

describe("rangeOfMonth", () => {
  it("converte o campo month em intervalo de datas", () => {
    expect(rangeOfMonth("2026-11")).toEqual({ de: "2026-11-01", ate: "2026-11-30" })
    expect(rangeOfMonth("2028-02")).toEqual({ de: "2028-02-01", ate: "2028-02-29" })
    expect(rangeOfMonth("2026-13")).toBeNull()
    expect(rangeOfMonth("")).toBeNull()
  })
})

describe("despesas", () => {
  const e = (situacao: "legado" | "pendente" | "paga", valor: number, data: string, pago_em: string | null = null, pago: number | null = null) => ({ situacao, valor_centavos: valor, data, pago_em, valor_pago_centavos: pago })

  it("vencida é a pendente com vencimento anterior a hoje; vencer hoje ainda é pendente", () => {
    expect(expenseView(e("pendente", 1, "2026-11-15"), "2026-11-16")).toBe("vencida")
    expect(expenseView(e("pendente", 1, "2026-11-16"), "2026-11-16")).toBe("pendente")
    expect(expenseView(e("paga", 1, "2026-11-01", "2026-11-20", 1), "2026-11-16")).toBe("paga")
    expect(expenseView(e("legado", 1, "2026-11-01"), "2026-11-16")).toBe("legado")
  })

  it("totais do mês de vencimento: paga usa o valor efetivo mesmo paga em outro mês; antigo nunca vira pago; recorrente futura é previsão", () => {
    const t = expenseTotals([
      e("pendente", 30000, "2026-11-05"), // vencida
      e("pendente", 10000, "2026-11-16"), // vence hoje: pendente, não vencida
      { ...e("pendente", 5000, "2026-11-23"), recurrence_id: "r1" }, // recorrente futura: valor previsto
      { ...e("pendente", 7000, "2026-11-10"), recurrence_id: "r1" }, // recorrente vencida: dívida, não previsão
      e("paga", 20000, "2026-11-28", "2026-10-30", 20000), // paga antecipada, em outubro
      e("paga", 9000, "2026-11-02", "2026-12-04", 9450), // paga atrasada, em dezembro, com juros
      e("legado", 100000, "2026-11-02"),
    ], "2026-11-16")
    expect(t.falta).toEqual({ cents: 52000, count: 4 })
    expect(t.vencidas).toEqual({ cents: 37000, count: 2 })
    expect(t.previstas).toEqual({ cents: 5000, count: 1 })
    expect(t.pagas).toEqual({ cents: 29450, count: 2 })
    expect(t.antigas).toEqual({ cents: 100000, count: 1 })
    expect(t.total).toEqual({ cents: 52000 + 29450 + 100000, count: 7 })
    expect(expenseTotals([], "2026-11-16").total).toEqual({ cents: 0, count: 0 })
  })

  it("mensagens: falha de rede e conta já paga são explicadas", () => {
    expect(financeErrorMessage(new TypeError("Failed to fetch"))).toMatch(/Sem conexão/)
    expect(financeErrorMessage({ message: "expense_not_pending" })).toMatch(/já foi paga/)
  })
})
