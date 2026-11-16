import { describe, expect, it } from "vitest"
import { aggregateCustomers, computeOccupancy, addDays, addMonths, bookingErrorMessage, monthGrid, weekStart, computeStats, formatTime, localDate, nearestFree, parseRange, slotTimes, validateContact, zonedToUtc, type BookingRow } from "./domain"

const SP = "America/Sao_Paulo"

describe("datas no fuso da barbearia", () => {
  it("converte o instante UTC para a data local", () => {
    expect(localDate("2026-11-07T02:30:00Z", SP)).toBe("2026-11-06")
    expect(localDate("2026-11-07T12:00:00Z", SP)).toBe("2026-11-07")
    expect(formatTime("2026-11-07T12:00:00Z", SP)).toBe("09:00")
  })

  it("soma dias atravessando mês e ano", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
  })

  it("converte o horário digitado na barbearia em UTC", () => {
    expect(zonedToUtc("2026-11-07T09:00", SP)).toBe("2026-11-07T12:00:00.000Z")
    expect(zonedToUtc("2026-11-07T23:30", SP)).toBe("2026-11-08T02:30:00.000Z")
  })

  it("lê o intervalo devolvido pelo banco", () => {
    expect(parseRange('["2026-11-07 12:00:00+00","2026-11-07 13:00:00+00")')).toEqual({
      inicio: "2026-11-07T12:00:00.000Z",
      fim: "2026-11-07T13:00:00.000Z",
    })
    expect(() => parseRange("vazio")).toThrow()
  })
})

describe("semana e mês", () => {
  it("a semana começa na segunda-feira", () => {
    expect(weekStart("2026-11-06")).toBe("2026-11-02")
    expect(weekStart("2026-11-08")).toBe("2026-11-02")
    expect(weekStart("2026-11-02")).toBe("2026-11-02")
  })

  it("navega entre meses e monta a grade", () => {
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01")
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01")
    const grade = monthGrid("2026-11-20")
    expect(grade.filter(Boolean)).toHaveLength(30)
    expect(grade.indexOf("2026-11-01")).toBe(6)
  })
})

describe("aggregateCustomers", () => {
  const b = (customer_id: string, status: string, offsetDays: number, preco = 6000) =>
    ({ customer_id, cliente_nome: `Cliente ${customer_id}`, cliente_whatsapp: "11912345678", status, preco_centavos: preco, inicio: new Date(Date.now() + offsetDays * 86_400_000).toISOString() }) as never

  it("agrupa por cliente, soma só concluídos e ignora cancelados", () => {
    const list = aggregateCustomers([b("a", "concluido", -10), b("a", "concluido", -3, 4000), b("a", "nao_compareceu", -20), b("a", "cancelado", -1), b("a", "confirmado", 4), b("b", "confirmado", 2)])
    const a = list.find((c) => c.id === "a")!
    expect(a).toMatchObject({ total: 4, concluidos: 2, faltas: 1, gasto: 10000 })
    expect(a.ultimo).toBe(new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10) + a.ultimo!.slice(10))
    expect(a.proxima).not.toBeNull()
    expect(list.find((c) => c.id === "b")).toMatchObject({ total: 1, concluidos: 0, gasto: 0, ultimo: null })
  })

  it("conta confirmadas, canceladas e faltas, e guarda o próximo agendamento com o serviço", () => {
    const x = (status: string, off: number, servico = "Corte") => ({ ...(b("a", status, off) as object), servico_nome: servico }) as never
    const [a] = aggregateCustomers([x("concluido", -10), x("confirmado", 2, "Barba"), x("confirmado", 6, "Corte"), x("cancelado", -3), x("cancelado", 1), x("nao_compareceu", -8)])
    expect(a).toMatchObject({ confirmados: 3, concluidos: 1, cancelados: 2, faltas: 1, total: 4, proximaServico: "Barba" })
  })

  it("cliente que só cancelou continua na lista, com a contagem de cancelamentos", () => {
    const [a] = aggregateCustomers([b("a", "cancelado", -2), b("a", "cancelado", 5)])
    expect(a).toMatchObject({ cancelados: 2, total: 0, confirmados: 0, proxima: null })
  })

  it("os termos aceitos valem os da reserva mais recente (pela data em que foi feita)", () => {
    const y = (lembretes: boolean, marketing: boolean, criado: string) => ({ ...(b("a", "confirmado", 2) as object), consent_lembretes: lembretes, consent_marketing: marketing, criado_em: criado }) as never
    expect(aggregateCustomers([y(true, true, "2026-01-01T00:00:00Z"), y(false, false, "2026-03-01T00:00:00Z")])[0]).toMatchObject({ avisos: false, novidades: false })
    expect(aggregateCustomers([y(false, false, "2026-01-01T00:00:00Z"), y(true, false, "2026-03-01T00:00:00Z")])[0]).toMatchObject({ avisos: true, novidades: false })
    expect(aggregateCustomers([b("a", "confirmado", 2)])[0]).toMatchObject({ avisos: null, novidades: null })
  })

  it("ordena pelo último atendimento e não inventa clientes", () => {
    expect(aggregateCustomers([])).toEqual([])
    expect(aggregateCustomers([b("a", "concluido", -10), b("b", "concluido", -2)]).map((c) => c.id)).toEqual(["b", "a"])
  })
})

describe("computeOccupancy", () => {
  const hoje = new Date().toISOString()
  const b = (min: number, status = "confirmado") => ({ inicio: hoje, status, duracao_min: min }) as never
  const semana = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ professional_id: "p", dow, inicio_min: 540, fim_min: 1080 }))

  it("divide minutos reservados pelos minutos de jornada dos próximos 7 dias", () => {
    // 7 dias × 540 min = 3780 min de jornada; 378 min reservados = 10%
    expect(computeOccupancy([b(180), b(198)], semana, "America/Sao_Paulo")).toBe(10)
  })

  it("ignora cancelados e não passa de 100%", () => {
    expect(computeOccupancy([b(60, "cancelado")], semana, "America/Sao_Paulo")).toBe(0)
    expect(computeOccupancy([b(99999)], semana, "America/Sao_Paulo")).toBe(100)
  })

  it("não inventa percentual sem jornada cadastrada", () => {
    expect(computeOccupancy([b(60)], [], "America/Sao_Paulo")).toBeNull()
  })
})

describe("validateContact", () => {
  it("exige nome e WhatsApp com DDD", () => {
    expect(validateContact({ nome: " ", whatsapp: "123" })).toEqual({
      nome: "Informe seu nome.",
      whatsapp: "Informe o WhatsApp com DDD, como +55 11 91234-5678.",
    })
    expect(validateContact({ nome: "Ana", whatsapp: "(11) 91234-5678" })).toEqual({})
  })
})

describe("bookingErrorMessage", () => {
  it.each([
    ["slot_taken", "Este horário acabou de ser ocupado. Escolha outro."],
    ["booking_limit", "Você já tem 3 reservas futuras ativas nesta barbearia."],
    ["cancel_window", "O prazo para cancelar já passou. Fale com a barbearia."],
    ["booking_started", "O horário desta reserva já começou. Fale com a barbearia."],
  ])("traduz %s", (message, text) => expect(bookingErrorMessage({ message })).toBe(text))

  it("nunca repassa mensagens internas", () => {
    expect(bookingErrorMessage({ message: "relation x does not exist" })).toBe("Não foi possível concluir. Tente novamente.")
  })
})

describe("computeStats", () => {
  const row = (status: string, offsetDays: number) =>
    ({ status, inicio: new Date(Date.now() + offsetDays * 86_400_000).toISOString() }) as unknown as BookingRow

  it("não inventa números sem reservas", () => {
    expect(computeStats([], SP)).toBeNull()
  })

  it("conta hoje, próximos 7 dias e comparecimento, ignorando cancelados", () => {
    const stats = computeStats([row("confirmado", 0), row("cancelado", 0), row("confirmado", 3), row("confirmado", 20), row("concluido", -2), row("concluido", -3), row("nao_compareceu", -4)], SP)
    expect(stats).toEqual({ today: 1, week: 1, attendance: 67 })
  })

  it("comparecimento fica vazio sem atendimentos encerrados", () => {
    expect(computeStats([row("confirmado", 1)], SP)?.attendance).toBeNull()
  })
})

describe("slotTimes (livre, ocupado e quem atende no horário)", () => {
  const h = (hhmm: string) => `2099-01-10T${hhmm}:00.000Z`
  const grid = [
    { prof_id: "f", prof_nome: "Francisco", slot_inicio: h("11"), livre: true },
    { prof_id: "f", prof_nome: "Francisco", slot_inicio: h("12"), livre: false },
    { prof_id: "m", prof_nome: "Marcelo", slot_inicio: h("12"), livre: true },
    { prof_id: "m", prof_nome: "Marcelo", slot_inicio: h("13"), livre: false },
  ]

  it("profissional escolhido: ocupado continua na lista e aponta quem está livre", () => {
    expect(slotTimes(grid, "f")).toEqual([
      { inicio: h("11"), livre: true, livres: [{ prof_id: "f", prof_nome: "Francisco", slot_inicio: h("11") }] },
      { inicio: h("12"), livre: false, livres: [{ prof_id: "m", prof_nome: "Marcelo", slot_inicio: h("12") }] },
    ])
  })

  it("qualquer profissional: livre se alguém atende; ocupado só quando ninguém atende", () => {
    expect(slotTimes(grid, null).map((t) => [t.inicio, t.livre])).toEqual([[h("11"), true], [h("12"), true], [h("13"), false]])
  })

  it("horários livres mais próximos, em ordem", () => {
    expect(nearestFree(slotTimes(grid, null), h("13"), 2).map((t) => t.inicio)).toEqual([h("11"), h("12")])
  })
})
