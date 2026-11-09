import { describe, expect, it } from "vitest"
import { centsFromTyping, formatMoneyInput } from "./money"

describe("formato de dinheiro (00,00 · 1.000,00)", () => {
  it("formata com 2 dígitos na parte inteira e separador de milhar", () => {
    expect(formatMoneyInput(0)).toBe("00,00")
    expect(formatMoneyInput(10)).toBe("00,10")
    expect(formatMoneyInput(100)).toBe("01,00")
    expect(formatMoneyInput(1000)).toBe("10,00")
    expect(formatMoneyInput(10000)).toBe("100,00")
    expect(formatMoneyInput(100000)).toBe("1.000,00")
    expect(formatMoneyInput(123456789)).toBe("1.234.567,89")
  })
  it("digitar da direita para a esquerda: 1, 0, 0 → 01,00 → 10,00 → 100,00", () => {
    expect(formatMoneyInput(centsFromTyping("1"))).toBe("00,01")
    expect(formatMoneyInput(centsFromTyping("00,01"))).toBe("00,01")
    expect(formatMoneyInput(centsFromTyping("00,10"))).toBe("00,10")
    expect(formatMoneyInput(centsFromTyping("01,00"))).toBe("01,00")
    expect(formatMoneyInput(centsFromTyping("100,00"))).toBe("100,00")
    expect(formatMoneyInput(centsFromTyping("1.000,00"))).toBe("1.000,00")
  })
  it("apagar um dígito mantém o formato, e o limite de 999.999,99 é respeitado", () => {
    expect(formatMoneyInput(centsFromTyping("01,0"))).toBe("00,10")
    expect(formatMoneyInput(centsFromTyping(""))).toBe("00,00")
    expect(formatMoneyInput(centsFromTyping("9999999999"))).toBe("999.999,99")
  })
})
