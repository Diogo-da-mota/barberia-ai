/// <reference types="@testing-library/jest-dom/vitest" />
import { fireEvent, render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/Shell", () => ({ Shell: ({ children, hero }: { children: React.ReactNode; hero?: boolean }) => <div data-testid="shell" data-hero={String(Boolean(hero))}>{children}</div> }))

import type { BookingRow } from "@/features/booking/domain"
import { AgendaBoard } from "./AgendaBoard"
import { HomeView, type HomeViewProps } from "./HomeView"
import { MiniCalendar } from "./MiniCalendar"
import { QuickActions } from "./QuickActions"
import { StatCards } from "./StatCards"

const row = (over: Partial<BookingRow> = {}): BookingRow => ({
  id: "b1", barbershop_id: "s1", professional_id: "p1", customer_id: "c1", service_id: "sv1", servico_nome: "Cabelo", preco_centavos: 5000, duracao_min: 30,
  inicio: "2099-01-10T11:00:00.000Z", fim: "2099-01-10T11:30:00.000Z", status: "confirmado", cliente_nome: "Diogo Mota", cliente_whatsapp: "64993296649",
  professionals: { nome: "Barbeiro Teste", avatar_path: null }, barbershops: { nome: "Loja", fuso: "America/Sao_Paulo", slug: "loja" },
  ...over,
} as BookingRow)

const view = (over: Partial<HomeViewProps> = {}) => ({
  name: "Diogo", isError: false, isRetrying: false, onRetry: () => {}, customerOnly: false, isManager: true, siteSlug: "loja", tz: "America/Sao_Paulo",
  result: { status: "ok", barbershops: [{ id: "s1", nome: "Loja", slug: "loja", endereco: "Rua do Pombo", status: "ativo", papel: "proprietario" }] },
  rows: [row()], allBookings: [row()], stats: { today: 2, week: 8, attendance: 90 }, occupancy: 68, received: 52000, ...over,
} as HomeViewProps)
const open = (props: HomeViewProps) => render(<MemoryRouter><HomeView {...props} /></MemoryRouter>)

describe("tela inicial: composição com a fotografia de fundo", () => {
  it("a saudação, os indicadores reais, a tabela, o calendário, a barbearia e as ações rápidas aparecem", () => {
    open(view())
    expect(screen.getByTestId("shell")).toHaveAttribute("data-hero", "true")
    expect(screen.getByRole("heading", { name: "Olá, Diogo" })).toBeInTheDocument()
    expect(screen.getByText("Atendimentos hoje").nextElementSibling).toHaveTextContent("2")
    expect(screen.getByText("Próximos 7 dias").nextElementSibling).toHaveTextContent("8")
    expect(screen.getByText("Recebido (mês)").nextElementSibling).toHaveTextContent("520,00")
    expect(screen.getByText("Ocupação (7 dias)").nextElementSibling).toHaveTextContent("68%")
    expect(screen.getByRole("heading", { name: "Próximos atendimentos" })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Calendário" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Sua barbearia" })).toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "Ações rápidas" })).toBeInTheDocument()
  })

  it("quem não é gestão não vê o financeiro nem ações de gestão", () => {
    open(view({ isManager: false, received: undefined, occupancy: null }))
    expect(screen.queryByText("Recebido (mês)")).not.toBeInTheDocument()
    expect(screen.getByText("Comparecimento (30 dias)")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Novo serviço/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Equipe/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: /Ver agenda/ }).length).toBeGreaterThan(0)
  })

  it("cliente comum vê só os próprios agendamentos, sem indicadores, calendário nem atalhos de gestão", () => {
    open(view({ customerOnly: true, isManager: false, stats: null, occupancy: null, received: undefined }))
    expect(screen.getByRole("heading", { name: "Seus próximos agendamentos" })).toBeInTheDocument()
    expect(screen.queryByText("Atendimentos hoje")).not.toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Calendário" })).not.toBeInTheDocument()
    expect(screen.queryByRole("navigation", { name: "Ações rápidas" })).not.toBeInTheDocument()
  })

  it("sem dados mostra — e nunca um número inventado", () => {
    render(<StatCards stats={null} occupancy={null} received={null} />)
    for (const label of ["Atendimentos hoje", "Próximos 7 dias", "Recebido (mês)", "Comparecimento (30 dias)"]) expect(screen.getByText(label).nextElementSibling).toHaveTextContent("—")
  })
})

describe("ações rápidas: só atalhos para telas que existem", () => {
  it("gestão: agenda, serviços, equipe e o site público em nova aba", () => {
    render(<MemoryRouter><QuickActions manager siteSlug="loja" /></MemoryRouter>)
    expect(screen.getByRole("link", { name: /Ver agenda/ })).toHaveAttribute("href", "/agendamentos")
    expect(screen.getByRole("link", { name: /Novo serviço/ })).toHaveAttribute("href", "/servicos")
    expect(screen.getByRole("link", { name: /Equipe/ })).toHaveAttribute("href", "/equipe")
    const site = screen.getByRole("link", { name: /Ver meu site/ })
    expect(site).toHaveAttribute("href", "/loja")
    expect(site).toHaveAttribute("target", "_blank")
  })

  it("barbearia inativa (sem página pública) não mostra o atalho do site", () => {
    render(<MemoryRouter><QuickActions manager siteSlug={null} /></MemoryRouter>)
    expect(screen.queryByRole("link", { name: /Ver meu site/ })).not.toBeInTheDocument()
  })
})

describe("próximos atendimentos", () => {
  it("mostra hora, serviço, cliente, profissional e o status real de cada reserva", () => {
    render(<MemoryRouter><AgendaBoard customerOnly={false} rows={[row(), row({ id: "b2", status: "pendente", cliente_nome: "Maria" })]} tz="America/Sao_Paulo" /></MemoryRouter>)
    const items = screen.getAllByRole("listitem")
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText("Confirmado")).toBeInTheDocument()
    expect(within(items[0]).getByText("Diogo Mota")).toBeInTheDocument()
    expect(within(items[0]).getByText("Barbeiro Teste")).toBeInTheDocument()
    expect(within(items[1]).getByText("Pendente")).toBeInTheDocument()
  })

  it("vazio e carregando têm estados próprios", () => {
    const { rerender } = render(<MemoryRouter><AgendaBoard customerOnly={false} rows={undefined} tz="America/Sao_Paulo" /></MemoryRouter>)
    expect(screen.getByRole("status", { name: "Carregando atendimentos" })).toBeInTheDocument()
    rerender(<MemoryRouter><AgendaBoard customerOnly={false} rows={[]} tz="America/Sao_Paulo" /></MemoryRouter>)
    expect(screen.getByText("Nenhum atendimento agendado")).toBeInTheDocument()
  })
})

describe("calendário do mês: clicar no dia mostra os atendimentos dele", () => {
  const hoje = new Date()
  const noon = (d: Date) => { const x = new Date(d); x.setHours(15, 0, 0, 0); return x.toISOString() }
  const diaBtn = (d: Date) => screen.getByRole("button", { name: new RegExp(`\\b${d.getDate()} de ${d.toLocaleDateString("pt-BR", { month: "long" })}`, "i") })

  it("mostra os atendimentos do dia clicado, avisa quando não há e volta para os próximos", () => {
    const outro = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() === 15 ? 16 : 15)
    const doDia = [row({ id: "d1", servico_nome: "Barba", inicio: noon(outro), fim: noon(outro) }), row({ id: "d2", servico_nome: "Sobrancelha", status: "cancelado", inicio: noon(outro), fim: noon(outro) })]
    open(view({ allBookings: doDia, rows: [row({ servico_nome: "Cabelo" })] }))
    expect(screen.getByRole("heading", { name: "Próximos atendimentos" })).toBeInTheDocument()
    fireEvent.click(diaBtn(outro))
    expect(screen.getByRole("heading", { name: /^Atendimentos de/ })).toBeInTheDocument()
    expect(screen.getByText("Barba")).toBeInTheDocument()
    expect(screen.queryByText("Sobrancelha")).not.toBeInTheDocument() // cancelada não aparece
    expect(screen.queryByText("Cabelo")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Ver próximos/ }))
    expect(screen.getByRole("heading", { name: "Próximos atendimentos" })).toBeInTheDocument()
  })

  it("dia sem atendimento mostra o estado vazio do dia", () => {
    const vazio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() === 20 ? 21 : 20)
    open(view({ allBookings: [] }))
    fireEvent.click(diaBtn(vazio))
    expect(screen.getByText("Nenhum atendimento neste dia")).toBeInTheDocument()
  })

  it("marca com um ponto os dias que têm atendimento", () => {
    const dia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() === 15 ? 16 : 15)
    render(<MiniCalendar rows={[row({ inicio: noon(dia), fim: noon(dia) })]} tz="America/Sao_Paulo" selected={null} onSelect={() => {}} />)
    expect(diaBtn(dia).closest("td")?.className).toContain("after:bg-primary")
  })
})

describe("Sua barbearia: logo à esquerda do título e botão à direita", () => {
  it("mostra a logo de Meu site antes do título e o botão Página pública na mesma linha, à direita", () => {
    open(view({ logoUrl: "https://cdn.exemplo/logo.png" }))
    const titulo = screen.getByRole("heading", { name: "Sua barbearia" })
    const logo = titulo.querySelector("img")
    expect(logo).toHaveAttribute("src", "https://cdn.exemplo/logo.png")
    // a logo vem antes do texto do título
    expect(titulo.firstElementChild).toBe(logo)
    const linha = titulo.parentElement!
    const botao = within(linha).getByRole("link", { name: /Página pública/ })
    expect(botao).toHaveAttribute("href", "/loja")
    // o botão fica depois do título, no lado direito da mesma linha
    expect(titulo.compareDocumentPosition(botao) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("sem logo cadastrada mostra o ícone padrão de loja (sem imagem quebrada)", () => {
    open(view({ logoUrl: null }))
    const titulo = screen.getByRole("heading", { name: "Sua barbearia" })
    expect(titulo.querySelector("img")).toBeNull()
    expect(titulo.querySelector("svg")).not.toBeNull()
  })

  it("barbearia inativa não mostra o botão da página pública", () => {
    open(view({ result: { status: "ok", barbershops: [{ id: "s1", nome: "Loja", slug: "loja", endereco: null, status: "inativo", papel: "proprietario" }] } as HomeViewProps["result"] }))
    expect(screen.queryByRole("link", { name: /Página pública/ })).not.toBeInTheDocument()
    expect(screen.getByText("Inativa")).toBeInTheDocument()
  })
})
