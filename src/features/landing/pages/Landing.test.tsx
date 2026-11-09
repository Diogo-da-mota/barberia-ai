/// <reference types="@testing-library/jest-dom/vitest" />

import { render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/lib/theme"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}))

vi.mock("@/features/auth/services/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/auth/services/auth")>()),
  getSession: mocks.getSession,
  onAuthStateChange: mocks.onAuthStateChange,
}))

import { Landing } from "./Landing"

function renderLanding() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <Landing />
      </MemoryRouter>
    </ThemeProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue(null)
  mocks.onAuthStateChange.mockReturnValue({ subscription: { unsubscribe: vi.fn() } })
})

describe("Landing", () => {
  it("diz no h1 o que é vendido e para quem", async () => {
    renderLanding()

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Agendamento online para barbearias")
  })

  it("apresenta benefícios, funcionamento, demonstração e rodapé", async () => {
    renderLanding()

    await screen.findByRole("heading", { level: 1 })
    for (const name of ["Recursos para a rotina da barbearia", "Como funciona o agendamento", "A agenda do dia por profissional"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument()
    }
    expect(screen.getByRole("contentinfo")).toBeInTheDocument()
  })

  it("oferece Entrar e Criar conta para visitantes", async () => {
    renderLanding()

    const header = screen.getByRole("banner")
    expect(await within(header).findByRole("button", { name: "Entrar" })).toBeInTheDocument()
    expect(within(header).getByRole("button", { name: "Criar conta" })).toBeInTheDocument()
    expect(within(header).queryByRole("link", { name: "Abrir painel" })).not.toBeInTheDocument()
  })

  it("troca os botões de acesso por Abrir painel quando há sessão", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1", user_metadata: {} } })
    renderLanding()

    const header = screen.getByRole("banner")
    expect(await within(header).findByRole("link", { name: "Abrir painel" })).toHaveAttribute("href", "/dashboard")
    await waitFor(() => expect(within(header).queryByRole("button", { name: "Entrar" })).not.toBeInTheDocument())
  })

  it("todos os links da página levam a um destino existente", async () => {
    const { container } = renderLanding()
    await screen.findByRole("heading", { level: 1 })

    const links = [...container.querySelectorAll("a")]
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      const href = link.getAttribute("href") ?? ""
      expect(href, link.textContent ?? "").not.toBe("")
      expect(href).not.toBe("#")
      if (href.startsWith("#") && href.length > 1) {
        expect(container.querySelector(href), href).not.toBeNull()
      }
    }
  })

  it("as demonstrações não têm controles sem função", async () => {
    const { container } = renderLanding()
    await screen.findByRole("heading", { level: 1 })

    const demos = container.querySelectorAll("[data-demo]")
    expect(demos.length).toBeGreaterThan(0)
    for (const demo of demos) {
      expect(demo.querySelector("a, button, input, select, textarea")).toBeNull()
      expect(demo).toHaveAttribute("role", "img")
      expect(demo.getAttribute("aria-label")).toBeTruthy()
    }
  })

  it("não mostra painel, menu administrativo, valores ou prova inventada", async () => {
    const { container } = renderLanding()
    await screen.findByRole("heading", { level: 1 })

    const text = container.textContent ?? ""
    expect(text).not.toMatch(/R\$/)
    expect(text).not.toMatch(/Próximos atendimentos|Suas barbearias|Indicadores|Faturamento/)
    expect(text).not.toMatch(/depoimento|avaliaç|clientes atendidos/i)
    expect(screen.queryByRole("button", { name: "Sair" })).not.toBeInTheDocument()
  })
})
