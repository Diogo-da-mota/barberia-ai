import { describe, expect, it } from "vitest"
import { slugify, validateBarbershop } from "@/features/barbershops/domain"
import { centsToInput, formatDuration, formatPrice, parsePriceToCents, validateProfessional, validateService } from "./domain"

describe("parsePriceToCents", () => {
  it.each([
    ["60", 6000],
    ["60,5", 6050],
    ["60,50", 6050],
    ["R$ 60,00", 6000],
    ["1.234,56", 123456],
    ["60.50", 6050],
    ["0", 0],
    ["  35  ", 3500],
  ])("converte %s em %i centavos, sem ponto flutuante", (text, cents) => {
    expect(parsePriceToCents(text)).toBe(cents)
  })

  it.each(["", "abc", "-5", "60,555", "1,2,3", "R$", "100000,01", "12.345.6"])("recusa %s", (text) => {
    expect(parsePriceToCents(text)).toBeNull()
  })
})

describe("formatação", () => {
  it("formata o preço em reais", () => {
    expect(formatPrice(6000)).toMatch(/^R\$\s60,00$/)
    expect(formatPrice(123456)).toMatch(/^R\$\s1\.234,56$/)
  })

  it.each([[20, "20 min"], [60, "1 h"], [90, "1 h 30 min"], [125, "2 h 5 min"]])("%i min vira %s", (min, text) => {
    expect(formatDuration(min)).toBe(text)
  })

  it("devolve o preço ao formato do campo", () => {
    expect(centsToInput(6050)).toBe("60,50")
    expect(centsToInput(0)).toBe("0,00")
  })
})

describe("validateService", () => {
  const base = { nome: "Corte", descricao: "", preco: "60,00", duracao: "40" }

  it("aceita um serviço válido e converte os valores", () => {
    expect(validateService(base)).toEqual({
      errors: {},
      value: { nome: "Corte", descricao: null, preco_centavos: 6000, duracao_min: 40, ativo: true },
    })
  })

  it("aceita preço zero, e mantém a descrição", () => {
    expect(validateService({ ...base, preco: "0", descricao: " Social " }).value).toMatchObject({ preco_centavos: 0, descricao: "Social" })
  })

  it("aponta cada campo inválido", () => {
    expect(validateService({ nome: " ", descricao: "", preco: "abc", duracao: "3" }).errors).toEqual({
      nome: "Informe o nome do serviço.",
      preco: "Informe um valor válido, como 60,00.",
      duracao: "Informe de 5 a 480 minutos.",
    })
    expect(validateService({ ...base, duracao: "40,5" }).errors.duracao).toBeDefined()
    expect(validateService({ ...base, nome: "x".repeat(81) }).errors.nome).toBe("Use até 80 caracteres.")
    expect(validateService({ ...base, descricao: "x".repeat(301) }).errors.descricao).toBe("Use até 300 caracteres.")
  })
})

describe("validateProfessional", () => {
  it("exige nome de até 80 caracteres", () => {
    expect(validateProfessional({ nome: "" }).nome).toBe("Informe o nome do profissional.")
    expect(validateProfessional({ nome: "x".repeat(81) }).nome).toBe("Use até 80 caracteres.")
    expect(validateProfessional({ nome: "João" })).toEqual({})
  })
})

describe("barbearia", () => {
  it.each([
    ["Barbearia do João", "barbearia-do-joao"],
    ["  Corte & Estilo!! ", "corte-estilo"],
    ["Ação Ágil", "acao-agil"],
    ["---", ""],
  ])("slugify(%s) = %s", (nome, slug) => {
    expect(slugify(nome)).toBe(slug)
  })

  it("limita o endereço a 60 caracteres", () => {
    expect(slugify("a".repeat(100))).toHaveLength(60)
  })

  it("valida nome e endereço público", () => {
    expect(validateBarbershop({ nome: "Minha Barbearia", slug: "minha-barbearia" })).toEqual({})
    expect(validateBarbershop({ nome: "", slug: "ab" })).toEqual({
      nome: "Informe o nome da barbearia.",
      slug: "Use de 3 a 60 letras minúsculas, números e hífens.",
    })
    expect(validateBarbershop({ nome: "X", slug: "Slug Ruim" }).slug).toBeDefined()
    expect(validateBarbershop({ nome: "X", slug: "-abc" }).slug).toBeDefined()
  })
})
