/// <reference types="@testing-library/jest-dom/vitest" />
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

const SHOP = { id: "loja-1", nome: "Barbearia", slug: "barbearia", endereco: null, status: "ativo", fuso: "America/Sao_Paulo", papel: "proprietario" }
const gate = vi.hoisted(() => ({ canManage: true }))
const api = vi.hoisted(() => ({
  fetchReport: vi.fn(), fetchCompletedBookings: vi.fn(), fetchPayments: vi.fn(), fetchPaymentsWindow: vi.fn(), fetchRefundsWindow: vi.fn(),
  fetchExpenses: vi.fn(), fetchPayouts: vi.fn(), fetchCommissions: vi.fn(), fetchRules: vi.fn(), createPayout: vi.fn(), addExpense: vi.fn(),
  registerPayment: vi.fn(), confirmPayment: vi.fn(), discardPayment: vi.fn(), refundPayment: vi.fn(), saveRule: vi.fn(), deleteRule: vi.fn(),
}))

vi.mock("@/app/Shell", () => ({ Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock("@/features/catalog/hooks/useActiveBarbershop", () => ({ useActiveBarbershop: () => ({ state: "ready", active: SHOP, canManage: gate.canManage }) }))
vi.mock("@/features/catalog/api", () => ({ fetchProfessionals: async () => ({ status: "ok", data: [{ id: "pr1", nome: "Ana" }] }), fetchServices: async () => ({ status: "ok", data: [] }) }))
vi.mock("../api", () => api)

import { Finance } from "./Finance"

/** Sem user-event no projeto: o Radix (abas) reage a mousedown, então o clique completo é simulado. */
const click = async (el: Element) => { fireEvent.mouseDown(el); fireEvent.mouseUp(el); fireEvent.click(el) }
const userEvent = { setup: () => ({ click }) }

const now = new Date()
const iso = (n = 0) => new Date(now.getTime() - n * 864e5).toISOString()
const booking = (id: string, cliente: string, preco: number) => ({ id, cliente_nome: cliente, servico_nome: "Corte", preco_centavos: preco, inicio: iso(), professionals: { nome: "Ana" } })

function setup(windowPayments: unknown[] = []) {
  api.fetchReport.mockResolvedValue({ previsto_centavos: 250000, recebido_centavos: 17000, custos_centavos: 138000, comissoes_provisionadas_centavos: 4000, comissoes_liquidadas_centavos: 3600, resultado_estimado_centavos: -121000 })
  api.fetchCompletedBookings.mockResolvedValue([booking("b1", "João Silva", 6000), booking("b2", "Carlos Souza", 4000)])
  api.fetchPayments.mockResolvedValue({ payments: [{ id: "p1", booking_id: "b1", valor_centavos: 6000, forma: "pix", parcelas: 1, criado_em: iso(), confirmado_em: iso() }], refunds: [] })
  api.fetchPaymentsWindow.mockResolvedValue(windowPayments)
  api.fetchRefundsWindow.mockResolvedValue([])
  api.fetchExpenses.mockResolvedValue([{ id: "e1", descricao: "Aluguel", categoria: "aluguel", valor_centavos: 120000, data: iso().slice(0, 10) }])
  api.fetchPayouts.mockResolvedValue([])
  api.fetchRules.mockResolvedValue([])
  api.fetchCommissions.mockResolvedValue([{ id: "c1", booking_id: "b1", professional_id: "pr1", valor_centavos: 2400, base_centavos: 6000, regra_tipo: "percentual", regra_valor: 4000, status: "provisionada", criado_em: iso(), professionals: { nome: "Ana" } }])
  api.createPayout.mockResolvedValue("payout-1")
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter><Finance /></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => { vi.clearAllMocks(); gate.canManage = true })

describe("Financeiro (gestão)", () => {
  it("cabeçalho com título, descrição, faixa de foto e as quatro abas", async () => {
    setup()
    expect(await screen.findByRole("heading", { level: 1, name: "Financeiro" })).toBeInTheDocument()
    expect(screen.getByText("Controle de pagamentos, comissões, repasses e custos da barbearia.")).toBeInTheDocument()
    expect(document.querySelector('[data-banner="financeiro"]')).not.toBeNull()
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Resumo", "Pagamentos", "Comissões", "Repasses", "Custos"])
  })

  it("Resumo: indicadores do relatório com variação sobre o mês anterior, estados vazios honestos e sem inventar números", async () => {
    setup()
    for (const label of ["Receita (recebido)", "Previsto (agendamentos)", "Custos", "Resultado estimado", "Comissões a repassar"]) expect((await screen.findAllByText(label)).length).toBeGreaterThan(0)
    expect(screen.getByText("R$ 2.500,00")).toBeInTheDocument()
    expect(screen.getByText(/-R\$\s?1\.210,00/)).toBeInTheDocument()
    expect(screen.getAllByText("vs. mês anterior")).toHaveLength(4)
    expect(api.fetchReport).toHaveBeenCalledWith("loja-1", expect.stringMatching(/^\d{4}-\d{2}-01$/), expect.any(String)) // mês atual e mês anterior
    expect(api.fetchReport.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(await screen.findByText("Ticket médio realizado")).toBeInTheDocument()
    expect(screen.getByText(/Precisa de 3 atendimentos pagos/)).toBeInTheDocument()
    expect(screen.queryByText(/mais lucrativo/i)).not.toBeInTheDocument() // custos não têm serviço: lucro por serviço não é calculável
  })

  it("Resumo: com dados reais mostra evolução, origem por forma de pagamento e movimentações", async () => {
    const paid = ([{ id: "p1", booking_id: "b1", valor_centavos: 6000, forma: "pix", parcelas: 1, criado_em: iso(), confirmado_em: iso(), bookings: { cliente_nome: "João Silva", servico_nome: "Corte", professionals: { nome: "Ana" } } }])
    setup(paid)
    expect(await screen.findByText("Origem da receita")).toBeInTheDocument()
    expect(await screen.findByText("João Silva · Corte")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /Receita por dia/ })).toBeInTheDocument()
    expect(screen.getByText("Serviço de maior receita")).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole("group", { name: "Série do gráfico" })).getByRole("button", { name: "Custos" }))
    expect(screen.getByText("Origem dos custos")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /Custos por dia/ })).toBeInTheDocument()
  })

  it("o seletor de mês só aparece nas abas que dependem do mês", async () => {
    setup()
    const user = userEvent.setup()
    expect(await screen.findByLabelText("Mês")).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "Pagamentos" }))
    expect(screen.queryByLabelText("Mês")).not.toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "Custos" }))
    expect(screen.getByLabelText("Mês")).toBeInTheDocument()
  })

  it("Pagamentos: busca e filtros por situação preservam o fluxo de registrar/confirmar", async () => {
    setup()
    const user = userEvent.setup()
    await user.click(await screen.findByRole("tab", { name: "Pagamentos" }))
    expect(await screen.findByText("João Silva")).toBeInTheDocument()
    expect(screen.getByText("Carlos Souza")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Buscar cliente ou serviço"), { target: { value: "carlos" } })
    expect(screen.queryByText("João Silva")).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Buscar cliente ou serviço"), { target: { value: "zzz" } })
    expect(screen.getByText("Nenhum atendimento encontrado")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Limpar filtros" }))
    const row = (await screen.findByText("Carlos Souza")).closest("li")!
    await user.click(within(row).getByRole("button", { name: /Pagamentos/ }))
    expect(await within(row).findByRole("button", { name: "Registrar pagamento" })).toBeInTheDocument()
  })

  it("Repasses: valores por profissional e repasse chamam create_payout com o profissional certo", async () => {
    setup()
    const user = userEvent.setup()
    await user.click(await screen.findByRole("tab", { name: "Repasses" }))
    await user.click(await screen.findByRole("button", { name: /Repassar R\$\s?24,00/ }))
    await waitFor(() => expect(api.createPayout).toHaveBeenCalledWith("pr1", expect.any(String)))
  })

  it("Comissões: lista calculada e regras, sem o botão de repasse", async () => {
    setup()
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Comissões" }))
    expect(await screen.findByText("Regras de comissão")).toBeInTheDocument()
    expect(screen.getByText("Comissões calculadas", { selector: "h2" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Repassar/ })).not.toBeInTheDocument()
  })

  it("Custos: valida campos obrigatórios antes de lançar", async () => {
    setup()
    const user = userEvent.setup()
    await user.click(await screen.findByRole("tab", { name: "Custos" }))
    await user.click(await screen.findByRole("button", { name: "Lançar custo" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe a descrição e a categoria.")
    expect(api.addExpense).not.toHaveBeenCalled()
    expect(screen.getByText("Aluguel")).toBeInTheDocument()
  })
})

describe("Financeiro (barbeiro)", () => {
  it("vê só Meus ganhos, sem abas de gestão", async () => {
    gate.canManage = false
    setup()
    expect(await screen.findByText("Meus ganhos")).toBeInTheDocument()
    expect(screen.queryAllByRole("tab")).toHaveLength(0)
    expect(await screen.findByText("A receber")).toBeInTheDocument()
  })
})
