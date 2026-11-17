import { describe, expect, it } from "vitest"
import { planLabel, planStatusLabel, planStatusVariant, planErrorMessage, planLimitWhatsAppUrl, usageText } from "./domain"

describe("planos", () => {
  it("rotula planos e estados", () => {
    expect(planLabel("inicial")).toBe("Inicial")
    expect(planLabel("rede")).toBe("Rede")
    expect(planLabel("outro")).toBe("outro")
    expect(planStatusLabel("trial")).toBe("Período de teste")
    expect(planStatusLabel("inadimplente")).toBe("Pagamento pendente")
    expect(planStatusVariant("ativa")).toBe("income")
    expect(planStatusVariant("suspensa")).toBe("danger")
    expect(planStatusVariant("trial")).toBe("info")
  })
  it("descreve o uso do limite de profissionais", () => {
    expect(usageText(2, 2)).toBe("2 de 2 profissionais ativos")
    expect(usageText(3, null)).toBe("3 profissionais ativos (sem limite)")
    expect(usageText(1, 6)).toBe("1 de 6 profissionais ativos")
  })
  it("traduz erros de limite e assinatura", () => {
    expect(planErrorMessage({ message: "plan_limit" })).toMatch(/limite de profissionais/)
    expect(planErrorMessage({ message: "subscription_inactive" })).toMatch(/assinatura/)
    expect(planErrorMessage({ message: "shop_limit" })).toMatch(/3 barbearias/)
    expect(planErrorMessage({ message: "x" })).toBeNull()
  })
})

describe("contato para aumentar o limite", () => {
  it("abre o WhatsApp do desenvolvedor com a mensagem e o nome da barbearia codificados", () => {
    const url = planLimitWhatsAppUrl("Babearia do TICO & Cia")
    expect(url.startsWith("https://wa.me/5564993296649?text=")).toBe(true)
    expect(decodeURIComponent(new URL(url).searchParams.get("text") ?? "")).toBe("Olá! Sou responsável pela barbearia Babearia do TICO & Cia e gostaria de aumentar o limite de profissionais da minha equipe. Podem me ajudar?")
    expect(url).not.toContain(" ")
    expect(url).toContain("%26") // & não quebra o parâmetro
  })
})
