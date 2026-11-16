// @vitest-environment node
import { describe, expect, it } from "vitest"
import { analyzeReturns, type Visit } from "./returns"

const TZ = "America/Sao_Paulo"
const TODAY = "2026-11-16"
const visit = (cliente: string, dia: string, over: Partial<Visit> = {}): Visit => ({
  customer_id: cliente, cliente_nome: cliente, cliente_whatsapp: "", service_id: "corte", servico_nome: "Corte",
  inicio: new Date(`${dia}T10:00:00-03:00`).toISOString(), ...over,
})

describe("frequência de retorno", () => {
  it("cliente com uma única visita não entra na média e sem histórico não há número", () => {
    const r = analyzeReturns([visit("ana", "2026-10-01")], TZ, TODAY)
    expect(r).toMatchObject({ recorrentes: 0, unicos: 1, mediaGeral: null, clientes: [], desde: "2026-10-01" })
    expect(analyzeReturns([], TZ, TODAY)).toMatchObject({ desde: null, recorrentes: 0, unicos: 0, mediaGeral: null })
  })

  it("média geral é a média das médias individuais: o cliente muito frequente não distorce", () => {
    const r = analyzeReturns([
      ...["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29"].map((d) => visit("ana", d)), // 4 intervalos de 7
      visit("bia", "2026-08-01"), visit("bia", "2026-08-31"), // 30
      visit("caio", "2026-07-01"), visit("caio", "2026-08-23"), // 53
      visit("duda", "2026-11-01"),
    ], TZ, TODAY)
    expect(r.mediaGeral).toBe(30) // (7 + 30 + 53) ÷ 3; a média de todos os intervalos juntos seria 18,5
    expect(r).toMatchObject({ recorrentes: 3, unicos: 1 })
    expect(r.clientes.find((c) => c.nome === "ana")).toMatchObject({ visitas: 5, media: 7, ultimo: "2026-09-29", diasDesde: 48, atrasado: true })
  })

  it("com menos de 3 clientes recorrentes a média geral fica sem dados suficientes, mas a individual aparece", () => {
    const r = analyzeReturns([visit("ana", "2026-11-01"), visit("ana", "2026-11-11")], TZ, TODAY)
    expect(r.mediaGeral).toBeNull()
    expect(r.clientes[0]).toMatchObject({ media: 10, diasDesde: 5, atrasado: false })
  })

  it("reservas no mesmo dia contam como uma visita, nunca como retorno em zero dias", () => {
    const r = analyzeReturns([
      visit("ana", "2026-11-01"), visit("ana", "2026-11-01", { service_id: "barba", servico_nome: "Barba", inicio: "2026-11-01T18:00:00Z" }),
      visit("ana", "2026-11-11"),
    ], TZ, TODAY)
    expect(r.clientes[0]).toMatchObject({ visitas: 2, media: 10 })
    expect(analyzeReturns([visit("bia", "2026-11-01"), visit("bia", "2026-11-01", { inicio: "2026-11-01T19:00:00Z" })], TZ, TODAY)).toMatchObject({ recorrentes: 0, unicos: 1 })
  })

  it("o dia da visita é o do fuso da barbearia", () => {
    // 22h de 01/11 em Brasília já é 02/11 em UTC: continua sendo a mesma data da visita das 10h
    const r = analyzeReturns([visit("ana", "2026-11-01"), visit("ana", "2026-11-01", { inicio: "2026-11-02T01:00:00Z" })], TZ, TODAY)
    expect(r).toMatchObject({ recorrentes: 0, unicos: 1 })
  })

  it("por serviço compara só atendimentos do mesmo serviço e ordena do retorno mais frequente ao menos", () => {
    const barba = { service_id: "barba", servico_nome: "Barba" }
    const rows = ["ana", "bia", "caio"].flatMap((c) => [
      visit(c, "2026-09-01"), visit(c, "2026-10-01"), // corte a cada 30
      visit(c, "2026-09-10", barba), visit(c, "2026-09-20", barba), // barba a cada 10
    ])
    const r = analyzeReturns(rows, TZ, TODAY, [{ id: "corte", nome: "Corte social", ativo: true }, { id: "combo", nome: "Corte + barba", ativo: true }])
    expect(r.servicos).toEqual([
      { key: "barba", nome: "Barba", media: 10, clientes: 3 },
      { key: "corte", nome: "Corte social", media: 30, clientes: 3 },
      { key: "combo", nome: "Corte + barba", media: null, clientes: 0 }, // cadastrado, sem histórico
    ])
    expect(r.clientes[0].media).toBe(10) // geral: 01/09, 10/09, 20/09, 01/10 → (9 + 10 + 11) ÷ 3
  })

  it("junta a reserva sem conta à conta com o mesmo WhatsApp e separa números diferentes", () => {
    const r = analyzeReturns([
      visit("ana", "2026-10-01", { cliente_whatsapp: "+55 64 99275-0733" }),
      visit("x", "2026-10-21", { customer_id: null, cliente_nome: "Ana Maria", cliente_whatsapp: "64992750733" }),
      visit("y", "2026-10-05", { customer_id: null, cliente_nome: "Rui", cliente_whatsapp: "+55 11 91234-5678" }),
      visit("z", "2026-10-09", { customer_id: null, cliente_nome: "Sem número", cliente_whatsapp: "" }),
    ], TZ, TODAY)
    expect(r).toMatchObject({ recorrentes: 1, unicos: 1 }) // sem conta e sem número não é identificável
    expect(r.clientes[0]).toMatchObject({ key: "ana", nome: "Ana Maria", visitas: 2, media: 20 })
  })
})
