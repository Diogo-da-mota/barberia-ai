/// <reference types="@testing-library/jest-dom/vitest" />
import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({ auth: { session: null as unknown, loading: false }, save: vi.fn() }))
vi.mock("@/features/auth/hooks/useAuth", () => ({ useAuth: () => m.auth }))
vi.mock("@/features/auth/services/auth", () => ({ saveAccentPreference: m.save }))

import { AccentPicker } from "@/ui/accent-picker"
import { AppearanceProvider, useShopAccent } from "./appearance"

const user = (accent?: string) => ({ user: { id: "u1", user_metadata: accent ? { accent } : {} } })
const html = () => document.documentElement.dataset.accent
function Shop({ color }: { color: string | null }) { useShopAccent(color); return null }
const ui = (color: string | null = null) => render(<AppearanceProvider><AccentPicker /><Shop color={color} /></AppearanceProvider>)
const pressed = () => screen.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent)

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.accent
  m.auth = { session: user(), loading: false }
  m.save.mockReset().mockResolvedValue(undefined)
})

describe("cor de destaque por usuário", () => {
  it("clicar troca a cor NA HORA no <html> (site inteiro) e guarda na conta", () => {
    ui()
    fireEvent.click(screen.getByRole("button", { name: "Azul" }))
    expect(html()).toBe("azul")
    expect(m.save).toHaveBeenCalledWith("azul")
    expect(localStorage.getItem("barberia:accent")).toBe("azul")
    expect(pressed()).toEqual(["Azul"])
    fireEvent.click(screen.getByRole("button", { name: "Violeta" }))
    expect(html()).toBe("violeta")
  })

  it("'Padrão' volta ao âmbar do sistema (sem data-accent) e também fica salvo", () => {
    ui()
    fireEvent.click(screen.getByRole("button", { name: "Verde" }))
    fireEvent.click(screen.getByRole("button", { name: "Padrão" }))
    expect(html()).toBeUndefined()
    expect(m.save).toHaveBeenLastCalledWith("padrao")
  })

  it("ao entrar, vale a cor guardada na conta (qualquer aparelho)", () => {
    m.auth = { session: user("vermelho"), loading: false }
    ui()
    expect(html()).toBe("vermelho")
    expect(pressed()).toEqual(["Vermelho"])
  })

  it("a cor da barbearia vale só para quem ainda não escolheu a própria", () => {
    ui("azul")
    expect(html()).toBe("azul")
    fireEvent.click(screen.getByRole("button", { name: "Verde" }))
    expect(html()).toBe("verde")
  })

  it("quem escolheu 'Padrão' não recebe a cor da barbearia", () => {
    m.auth = { session: user("padrao"), loading: false }
    ui("azul")
    expect(html()).toBeUndefined()
  })

  it("visitante sem conta vê a cor da barbearia e não guarda nada; sair apaga a cor deste navegador", () => {
    localStorage.setItem("barberia:accent", "violeta")
    m.auth = { session: null, loading: false }
    ui("azul")
    expect(html()).toBe("azul")
    expect(localStorage.getItem("barberia:accent")).toBeNull()
  })

  it("enquanto a conta carrega, mantém a cor guardada no aparelho (sem piscar)", () => {
    localStorage.setItem("barberia:accent", "verde")
    m.auth = { session: null, loading: true }
    ui()
    expect(html()).toBe("verde")
    expect(localStorage.getItem("barberia:accent")).toBe("verde")
  })

  it("se a conta não puder guardar, a cor já mudou e o usuário é avisado", async () => {
    m.save.mockRejectedValue(new Error("rede"))
    ui()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Azul" })) })
    expect(html()).toBe("azul")
    expect(m.save).toHaveBeenCalled()
  })
})
