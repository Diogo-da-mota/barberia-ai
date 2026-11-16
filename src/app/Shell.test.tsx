/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, useLocation } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/lib/theme"

const mocks = vi.hoisted(() => ({
  fetchMyBarbershops: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("@/features/auth/services/auth", () => ({
  getSession: mocks.getSession,
  onAuthStateChange: mocks.onAuthStateChange,
  signOut: mocks.signOut,
}))

vi.mock("@/features/home/api", () => ({ fetchMyBarbershops: mocks.fetchMyBarbershops }))

vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { error: mocks.toastError },
}))

import { Shell } from "./Shell"

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>
}

const SHOP = { id: "b1", nome: "Barbearia", slug: "minha-barbearia", endereco: null, status: "ativo", fuso: "America/Sao_Paulo" }
const withRole = (papel: string, shop = SHOP) =>
  mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [{ ...shop, papel }] })

function renderShell(path = "/dashboard") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Shell>
            <p>conteúdo</p>
          </Shell>
          <CurrentPath />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ user: { id: "u1", user_metadata: {} } })
  withRole("proprietario")
  mocks.onAuthStateChange.mockReturnValue({ subscription: { unsubscribe: vi.fn() } })
})

describe("Shell", () => {
  const hrefsOf = (nav: HTMLElement) => within(nav).getAllByRole("link").map((link) => link.getAttribute("href"))

  it("a barra inferior mantém os 5 destinos do Design System", async () => {
    renderShell()
    await screen.findByRole("link", { name: "Clientes" })

    const [, bottom] = screen.getAllByRole("navigation", { name: "Navegação principal" })
    expect(hrefsOf(bottom)).toEqual(["/dashboard", "/dashboard/agendamentos", "/dashboard/servicos", "/dashboard/equipe", "/dashboard/mais"])
  })

  it("a sidebar da equipe não tem Minhas reservas: essa área é do cliente final", async () => {
    for (const papel of ["proprietario", "gerente", "barbeiro"]) {
      withRole(papel)
      const view = renderShell()
      await screen.findByRole("link", { name: "Clientes" })
      expect(screen.queryByRole("link", { name: "Minhas reservas" })).not.toBeInTheDocument()
      const [sidebar] = screen.getAllByRole("navigation", { name: "Navegação principal" })
      expect(hrefsOf(sidebar)).not.toContain("/minhas-reservas")
      view.unmount()
    }
  })

  it("a sidebar do proprietário reúne todas as rotas do painel (a página pública fica no botão Ver site)", async () => {
    renderShell()
    await screen.findByRole("link", { name: "Clientes" })

    const [sidebar] = screen.getAllByRole("navigation", { name: "Navegação principal" })
    expect(hrefsOf(sidebar)).toEqual([
      "/dashboard", "/dashboard/agendamentos", "/dashboard/clientes", "/dashboard/servicos", "/dashboard/equipe",
      "/dashboard/financeiro", "/dashboard/analises", "/dashboard/mensagens", "/dashboard/site", "/dashboard/configuracoes", "/dashboard/mais",
    ])
  })

  it("o layout é fixo: só o main rola; sidebar e header nunca se movem com a página", async () => {
    const { container } = renderShell()
    await screen.findByRole("link", { name: "Clientes" })
    const root = container.firstElementChild as HTMLElement
    // `relative` é essencial: sem ele, elementos absolutos (sr-only, como os campos de arquivo) escapam do corte e fazem o documento rolar
    expect(root.className).toMatch(/\brelative\b/)
    expect(root.className).toMatch(/\bh-dvh\b/)
    expect(root.className).toMatch(/\boverflow-hidden\b/)
    expect(screen.getByRole("main").className).toMatch(/overflow-y-auto/)
    expect(screen.getByRole("main").className).toMatch(/overscroll-contain/)
    expect(screen.getByRole("banner", { name: "Cabeçalho do painel" }).className).toMatch(/shrink-0/)
    expect(container.querySelector("aside")?.className).toMatch(/shrink-0/)
  })

  it("o header do painel tem o botão Ver site, com a rota da página pública, e a sidebar não repete o destino", async () => {
    renderShell()
    const ver = await screen.findByRole("link", { name: "Ver site" })
    expect(ver).toHaveAttribute("href", "/minha-barbearia")
    expect(ver).toHaveAttribute("target", "_blank")
    expect(ver).toHaveAttribute("rel", expect.stringContaining("noopener"))
    expect(screen.getAllByRole("link", { name: "Ver site" })).toHaveLength(1)
    const header = screen.getByRole("banner", { name: "Cabeçalho do painel" })
    expect(within(header).getByText("Barbearia")).toBeInTheDocument()
    expect(within(header).getByRole("link", { name: "Ver site" })).toBe(ver)
    const [sidebar] = screen.getAllByRole("navigation", { name: "Navegação principal" })
    expect(within(sidebar).queryByRole("link", { name: "Ver site" })).not.toBeInTheDocument()
    expect(within(sidebar).queryByRole("link", { name: "Página pública" })).not.toBeInTheDocument()
  })

  it("barbeiro também vê Ver site; barbearia inativa e cliente sem barbearia não", async () => {
    withRole("barbeiro")
    let view = renderShell()
    expect(await screen.findByRole("link", { name: "Ver site" })).toBeInTheDocument()
    view.unmount()

    withRole("gerente", { ...SHOP, status: "inativo" })
    view = renderShell()
    await screen.findByRole("link", { name: "Clientes" })
    expect(screen.queryByRole("link", { name: "Ver site" })).not.toBeInTheDocument()
    view.unmount()

    withRole("cliente")
    renderShell()
    await screen.findByRole("link", { name: "Minhas reservas" })
    expect(screen.queryByRole("link", { name: "Ver site" })).not.toBeInTheDocument()
  })

  it("Mensagens, Meu site e Configurações são só da gestão: gerente vê, barbeiro não", async () => {
    withRole("gerente")
    const view = renderShell()
    expect(await screen.findByRole("link", { name: "Mensagens" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Meu site" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Configurações" })).toHaveAttribute("href", "/dashboard/configuracoes")
    expect(screen.getByRole("button", { name: "Conversar com a Lara" })).toBeInTheDocument() // Lara flutuante só da gestão
    view.unmount()

    withRole("barbeiro")
    renderShell()
    await screen.findByRole("link", { name: "Financeiro" })
    expect(screen.queryByRole("link", { name: "Mensagens" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Meu site" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Configurações" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Análises" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Conversar com a Lara" })).not.toBeInTheDocument()
  })

  it("no celular o botão Menu abre a mesma lista da sidebar, sem repetir destinos", async () => {
    renderShell()
    await screen.findByRole("link", { name: "Clientes" })
    const [sidebar] = screen.getAllByRole("navigation", { name: "Navegação principal" })
    const doSidebar = hrefsOf(sidebar)
    fireEvent.click(screen.getByRole("button", { name: "Menu" })) // o botão tem comportamento real: abre o menu completo
    const menu = await screen.findByRole("navigation", { name: "Menu completo" })
    expect(hrefsOf(menu)).toEqual(doSidebar)
    expect(new Set(hrefsOf(menu)).size).toBe(hrefsOf(menu).length)
    fireEvent.click(within(menu).getByRole("link", { name: "Financeiro" }))
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/dashboard/financeiro"))
    expect(screen.queryByRole("navigation", { name: "Menu completo" })).not.toBeInTheDocument()
  })

  it("o barbeiro vê Financeiro (seus ganhos) e o cliente comum não", async () => {
    withRole("barbeiro")
    const view = renderShell()
    expect(await screen.findByRole("link", { name: "Financeiro" })).toBeInTheDocument()
    view.unmount()

    withRole("cliente")
    renderShell()
    await screen.findByRole("link", { name: "Minhas reservas" })
    expect(screen.queryByRole("link", { name: "Financeiro" })).not.toBeInTheDocument()
  })

  it("os horários não têm mais item no menu: ficam na edição do profissional (Equipe)", async () => {
    withRole("gerente")
    renderShell()
    await screen.findByRole("link", { name: "Equipe" })
    expect(screen.queryByRole("link", { name: "Horários" })).not.toBeInTheDocument()
  })

  it("o cliente comum vê só Início, Minhas reservas e Mais", async () => {
    withRole("cliente")
    renderShell()
    await screen.findByRole("link", { name: "Minhas reservas" })

    const [sidebar] = screen.getAllByRole("navigation", { name: "Navegação principal" })
    expect(hrefsOf(sidebar)).toEqual(["/dashboard", "/minhas-reservas", "/dashboard/mais"])
  })

  it("barbearia inativa não oferece a página pública", async () => {
    withRole("proprietario", { ...SHOP, status: "inativo" })
    renderShell()
    await screen.findByRole("link", { name: "Clientes" })
    expect(screen.queryByRole("link", { name: "Página pública" })).not.toBeInTheDocument()
  })

  it("marca somente o destino atual", async () => {
    renderShell("/dashboard/agendamentos")
    await screen.findByRole("link", { name: "Clientes" })

    const [sidebar] = screen.getAllByRole("navigation", { name: "Navegação principal" })
    const links = within(sidebar).getAllByRole("link")
    const current = links.filter((link) => link.getAttribute("aria-current") === "page")
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAttribute("href", "/dashboard/agendamentos")
  })

  it("encerra a sessão e volta à Landing Page ao clicar em Sair", async () => {
    mocks.signOut.mockResolvedValue(undefined)
    renderShell()

    fireEvent.click(screen.getAllByRole("button", { name: "Sair" })[0])

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId("path")).toHaveTextContent(/^\/$/)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it("avisa quando não consegue encerrar a sessão", async () => {
    mocks.signOut.mockRejectedValue(new Error("detalhe interno"))
    renderShell()

    fireEvent.click(screen.getAllByRole("button", { name: "Sair" })[0])

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Não foi possível sair. Tente novamente.")
    )
  })
})
