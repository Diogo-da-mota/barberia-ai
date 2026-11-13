import { describe, expect, it } from "vitest"
import { firstName, formatToday, isCustomerOnly, isStaff, type MyBarbershop } from "./domain"

const shop = (papel: MyBarbershop["papel"]): MyBarbershop => ({
  id: papel,
  nome: "Barbearia de teste",
  slug: "teste",
  endereco: null,
  status: "ativo",
  papel,
})

describe("isStaff", () => {
  it("só a equipe entra na gestão: conta logada sem papel de equipe (cliente ou sem barbearia) não", () => {
    expect(isStaff([shop("cliente")])).toBe(false)
    expect(isStaff([])).toBe(false)
    expect(isStaff([shop("cliente"), shop("barbeiro")])).toBe(true)
    expect(isStaff([shop("proprietario")])).toBe(true)
  })
})

describe("isCustomerOnly", () => {
  it("é verdadeiro quando todos os vínculos são de cliente", () => {
    expect(isCustomerOnly([shop("cliente"), shop("cliente")])).toBe(true)
  })

  it("é falso quando existe vínculo de equipe", () => {
    expect(isCustomerOnly([shop("cliente"), shop("barbeiro")])).toBe(false)
  })

  it("é falso sem vínculos, pois o papel ainda é desconhecido", () => {
    expect(isCustomerOnly([])).toBe(false)
  })
})

describe("firstName", () => {
  it("usa o primeiro nome de full_name", () => {
    expect(firstName({ full_name: "  Maria Souza Lima " })).toBe("Maria")
  })

  it("usa name quando full_name não existe", () => {
    expect(firstName({ name: "João Silva" })).toBe("João")
  })

  it("retorna null sem nome utilizável", () => {
    expect(firstName({ full_name: "   " })).toBeNull()
    expect(firstName({ full_name: 42 })).toBeNull()
    expect(firstName(undefined)).toBeNull()
  })
})

describe("formatToday", () => {
  it("formata em pt-BR com a inicial maiúscula", () => {
    expect(formatToday(new Date(2026, 10, 6, 12))).toBe("Sexta-feira, 6 de novembro")
  })
})
