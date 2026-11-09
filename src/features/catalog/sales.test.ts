// @vitest-environment node
import { describe, expect, it } from "vitest"
import { averageTicket, salesByService, topSellers, type SaleRow } from "./sales"

const sale = (id: string, service_id: string | null, preco = 6000): SaleRow => ({ id, service_id, preco_centavos: preco })
const pay = (id: string, booking_id: string, valor: number, confirmado_em: string | null = "2026-01-01") => ({ id, booking_id, valor_centavos: valor, confirmado_em })

describe("vendas reais por serviço", () => {
  it("conta atendimentos concluídos por serviço e ignora venda sem serviço", () => {
    const c = salesByService([sale("1", "a"), sale("2", "a"), sale("3", "b"), sale("4", null)])
    expect([...c]).toEqual([["a", 2], ["b", 1]])
  })

  it("o selo vai para o mais vendido (empate leva todos); sem vendas, ninguém", () => {
    expect([...topSellers(new Map([["a", 5], ["b", 2]]))]).toEqual(["a"])
    expect([...topSellers(new Map([["a", 3], ["b", 3], ["c", 1]]))].sort()).toEqual(["a", "b"])
    expect(topSellers(new Map()).size).toBe(0)
  })
})

describe("ticket médio realizado", () => {
  const sales = [sale("1", "a"), sale("2", "a"), sale("3", "b"), sale("4", "b")]

  it("é o valor efetivamente recebido por atendimento, não o preço do cadastro", () => {
    const t = averageTicket(sales, [pay("p1", "1", 5000), pay("p2", "2", 6000), pay("p3", "3", 7000)], [])
    expect(t).toEqual({ cents: 6000, count: 3 }) // (5000+6000+7000)/3, mesmo com preços de cadastro de 6000
  })

  it("só conta pagamento confirmado; o 'a confirmar' ainda não é receita", () => {
    expect(averageTicket(sales, [pay("p1", "1", 5000), pay("p2", "2", 6000), pay("p3", "3", 7000), pay("p4", "4", 9000, null)], [])).toEqual({ cents: 6000, count: 3 })
  })

  it("desconta estornos; atendimento totalmente estornado fica de fora", () => {
    const t = averageTicket(sales, [pay("p1", "1", 6000), pay("p2", "2", 6000), pay("p3", "3", 6000), pay("p4", "4", 6000)], [{ payment_id: "p2", valor_centavos: 2000 }, { payment_id: "p4", valor_centavos: 6000 }])
    expect(t).toEqual({ cents: 5333, count: 3 }) // (6000 + 4000 + 6000) / 3
  })

  it("com menos de 3 atendimentos pagos não inventa: null (Sem dados suficientes)", () => {
    expect(averageTicket(sales, [pay("p1", "1", 5000), pay("p2", "2", 6000)], [])).toBeNull()
    expect(averageTicket([], [], [])).toBeNull()
  })
})
