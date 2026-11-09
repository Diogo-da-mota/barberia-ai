/// <reference types="@testing-library/jest-dom/vitest" />

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/lib/theme"
import type { MyBarbershop } from "../domain"

const mocks = vi.hoisted(() => ({
  fetchMyBarbershops: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock("@/features/home/api", () => ({
  fetchMyBarbershops: mocks.fetchMyBarbershops,
}))

vi.mock("@/features/auth/services/auth", () => ({
  getSession: mocks.getSession,
  onAuthStateChange: mocks.onAuthStateChange,
  signOut: mocks.signOut,
}))

vi.mock("@/features/booking/api", () => ({
  fetchShopBookings: vi.fn().mockResolvedValue([]),
  fetchMyBookings: vi.fn().mockResolvedValue([]),
  fetchShopHours: vi.fn().mockResolvedValue([]),
}))

import { Home } from "./Home"

const SHOP: MyBarbershop = {
  id: "b1",
  nome: "Barbearia de Teste",
  slug: "barbearia de teste",
  endereco: "Rua Fictícia",
  status: "ativo",
  papel: "proprietario",
}

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({
    user: { id: "user-1", user_metadata: { full_name: "Maria Souza" } },
  })
  mocks.onAuthStateChange.mockReturnValue({ subscription: { unsubscribe: vi.fn() } })
})

// o nome da barbearia também aparece no header do painel: o teste procura só o item da lista
const findInList = async (name: string) => (await screen.findAllByText(name)).find((el) => el.closest("li")) as HTMLElement

describe("Home", () => {
  it("cumprimenta pelo primeiro nome e consulta os vínculos do usuário da sessão", async () => {
    mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [] })
    renderHome()

    expect(await screen.findByRole("heading", { level: 1, name: "Olá, Maria" })).toBeInTheDocument()
    expect(mocks.fetchMyBarbershops).toHaveBeenCalledWith("user-1")
  })

  it("mostra skeleton enquanto as barbearias carregam", async () => {
    mocks.fetchMyBarbershops.mockReturnValue(new Promise(() => {}))
    renderHome()

    expect(await screen.findByRole("status", { name: "Carregando suas barbearias" })).toBeInTheDocument()
  })

  it("explica o estado vazio sem barbearia vinculada", async () => {
    mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [] })
    renderHome()

    expect(await screen.findByText("Nenhuma barbearia vinculada")).toBeInTheDocument()
  })

  it("diferencia banco ainda não preparado de erro", async () => {
    mocks.fetchMyBarbershops.mockResolvedValue({ status: "unavailable" })
    renderHome()

    expect(await screen.findByText("Cadastro de barbearias indisponível")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).not.toBeInTheDocument()
  })

  it("mostra erro sem detalhes internos e permite tentar novamente", async () => {
    mocks.fetchMyBarbershops.mockRejectedValueOnce(new Error("detalhe interno do banco"))
    mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [SHOP] })
    renderHome()

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar suas barbearias")
    expect(screen.queryByText(/detalhe interno/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }))

    expect(await findInList("Barbearia de Teste")).toBeInTheDocument()
  })

  it("lista a barbearia com papel e link público real", async () => {
    mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [SHOP] })
    renderHome()

    const row = (await findInList("Barbearia de Teste")).closest("li")
    expect(row).not.toBeNull()
    expect(within(row!).getByText("Proprietário")).toBeInTheDocument()
    expect(within(row!).getByText("Rua Fictícia")).toBeInTheDocument()
    // o botão fica na linha do título "Sua barbearia", à direita
    const card = screen.getByRole("heading", { name: "Sua barbearia" }).closest("section")!
    expect(within(card).getByRole("link", { name: /Página pública/ })).toHaveAttribute(
      "href",
      "/barbearia%20de%20teste"
    )
  })

  it("não oferece link público para barbearia inativa", async () => {
    mocks.fetchMyBarbershops.mockResolvedValue({
      status: "ok",
      barbershops: [{ ...SHOP, status: "inativo" }],
    })
    renderHome()

    const row = (await findInList("Barbearia de Teste")).closest("li")
    expect(within(row!).getByText("Inativa")).toBeInTheDocument()
    expect(within(row!).queryByRole("link")).not.toBeInTheDocument()
  })

  it("não inventa números nos indicadores", async () => {
    mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [SHOP] })
    renderHome()

    const indicators = await screen.findByRole("region", { name: "Indicadores" })
    expect(within(indicators).getAllByText("—")).toHaveLength(4)
    expect(within(indicators).queryByText(/^\d+%?$/)).not.toBeInTheDocument()
  })

  it("esconde os indicadores internos de quem só é cliente", async () => {
    mocks.fetchMyBarbershops.mockResolvedValue({
      status: "ok",
      barbershops: [{ ...SHOP, papel: "cliente" }],
    })
    renderHome()

    await screen.findByText("Barbearia de Teste")
    expect(screen.queryByRole("region", { name: "Indicadores" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 2, name: "Seus próximos agendamentos" })).toBeInTheDocument()
  })

  it("mostra a agenda vazia com link real para agendamentos", async () => {
    mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [SHOP] })
    renderHome()

    const board = await screen.findByRole("region", { name: "Próximos atendimentos" })
    expect(within(board).getByText("Nenhum atendimento agendado")).toBeInTheDocument()
    expect(within(board).getByRole("link", { name: /Ver agenda/ })).toHaveAttribute("href", "/dashboard/agendamentos")
  })
})
