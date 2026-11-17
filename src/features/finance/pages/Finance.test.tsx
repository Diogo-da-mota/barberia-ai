/// <reference types="@testing-library/jest-dom/vitest" />
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

const SHOP = { id: "loja-1", nome: "Barbearia", slug: "barbearia", endereco: null, status: "ativo", fuso: "America/Sao_Paulo", papel: "proprietario" }
const gate = vi.hoisted(() => ({ canManage: true }))
const api = vi.hoisted(() => ({
  fetchReport: vi.fn(), fetchCompletedBookings: vi.fn(), fetchPayments: vi.fn(), fetchPaymentsWindow: vi.fn(), fetchRefundsWindow: vi.fn(),
  fetchExpenses: vi.fn(), fetchPayouts: vi.fn(), fetchCommissions: vi.fn(), fetchRules: vi.fn(), createPayout: vi.fn(),
  fetchExpenseBook: vi.fn(), fetchExpenseEvents: vi.fn(), createExpenses: vi.fn(), updateExpenseDetails: vi.fn(), revertExpensePayment: vi.fn(), createExpense: vi.fn(), updateExpense: vi.fn(), payExpense: vi.fn(), deleteExpense: vi.fn(), endExpenseRecurrence: vi.fn(),
  registerPayment: vi.fn(), confirmPayment: vi.fn(), discardPayment: vi.fn(), refundPayment: vi.fn(), saveRule: vi.fn(), deleteRule: vi.fn(),
}))

vi.mock("@/app/Shell", () => ({ Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock("@/features/catalog/hooks/useActiveBarbershop", () => ({ useActiveBarbershop: () => ({ state: "ready", active: SHOP, canManage: gate.canManage }) }))
vi.mock("@/features/catalog/api", () => ({ fetchProfessionals: async () => ({ status: "ok", data: [{ id: "pr1", nome: "Ana" }] }), fetchServices: async () => ({ status: "ok", data: [] }) }))
vi.mock("../api", () => api)

import { addDays, addMonths, formatDay, todayIn } from "@/features/booking/domain"
import { Finance } from "./Finance"

/** Sem user-event no projeto: o Radix (abas) reage a mousedown, então o clique completo é simulado. */
const click = async (el: Element) => { fireEvent.mouseDown(el); fireEvent.mouseUp(el); fireEvent.click(el) }
const userEvent = { setup: () => ({ click }) }

/** Lista suspensa (Radix Select): abre pelo teclado e escolhe a opção pelo nome. */
const escolher = async (campo: Element, opcao: string) => { fireEvent.keyDown(campo, { key: "Enter" }); fireEvent.click(await screen.findByRole("option", { name: opcao })) }
const now = new Date()
const iso = (n = 0) => new Date(now.getTime() - n * 864e5).toISOString()
const HOJE = todayIn("America/Sao_Paulo")
const conta = (id: string, descricao: string, valor: number, data: string, extra: Record<string, unknown> = {}) => ({ id, descricao, categoria: "Contas fixas", valor_centavos: valor, data, situacao: "pendente", pago_em: null, valor_pago_centavos: null, forma: null, linha_digitavel: null, recurrence_id: null, ...extra })
const booking = (id: string, cliente: string, preco: number) => ({ id, cliente_nome: cliente, servico_nome: "Corte", preco_centavos: preco, inicio: iso(), professionals: { nome: "Ana" } })

function setup(windowPayments: unknown[] = []) {
  api.fetchReport.mockResolvedValue({ previsto_centavos: 250000, recebido_centavos: 17000, custos_centavos: 138000, comissoes_provisionadas_centavos: 4000, comissoes_liquidadas_centavos: 3600, resultado_estimado_centavos: -121000 })
  api.fetchCompletedBookings.mockResolvedValue([booking("b1", "João Silva", 6000), booking("b2", "Carlos Souza", 4000)])
  api.fetchPayments.mockResolvedValue({ payments: [{ id: "p1", booking_id: "b1", valor_centavos: 6000, forma: "pix", parcelas: 1, criado_em: iso(), confirmado_em: iso() }], refunds: [] })
  api.fetchPaymentsWindow.mockResolvedValue(windowPayments)
  api.fetchRefundsWindow.mockResolvedValue([])
  api.fetchExpenses.mockResolvedValue([{ id: "e1", descricao: "Aluguel", categoria: "aluguel", valor_centavos: 120000, data: iso().slice(0, 10) }])
  api.fetchExpenseBook.mockResolvedValue({
    entries: [
      conta("d1", "Energia elétrica", 30000, addDays(HOJE, -1)),
      conta("d2", "Internet", 10000, HOJE),
      conta("d3", "Aluguel do salão", 120000, addDays(HOJE, -2), { situacao: "paga", pago_em: HOJE, valor_pago_centavos: 120000, forma: "pix" }),
    ],
    recurrences: [],
  })
  api.fetchExpenseEvents.mockResolvedValue([])
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
    expect(screen.getByText("Controle de pagamentos, comissões, repasses e despesas da barbearia.")).toBeInTheDocument()
    expect(document.querySelector('[data-banner="financeiro"]')).not.toBeNull()
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Resumo", "Pagamentos", "Comissões", "Repasses", "Despesas"])
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
    await user.click(screen.getByRole("tab", { name: "Despesas" }))
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

  const abrirDespesas = async () => {
    setup()
    const user = userEvent.setup()
    await user.click(await screen.findByRole("tab", { name: "Despesas" }))
    await screen.findByText("Energia elétrica")
    return user
  }
  const metric = (label: string) => screen.getByText(label, { selector: "p" }).parentElement!

  const situacao = (name: string) => within(screen.getByRole("group", { name: "Situação" })).getByRole("button", { name })
  const nomes = () => ["Energia elétrica", "Internet", "Aluguel do salão"].filter((n) => screen.queryByText(n, { selector: "span.truncate" }))

  it("Despesas: quatro indicadores do mês; vencida é calculada pela data; filtros respeitam o mês; contas agrupadas por data", async () => {
    const user = await abrirDespesas()
    expect(metric("Total do mês")).toHaveTextContent(/R\$\s?1\.600,00.*3 contas/)
    expect(metric("Falta pagar")).toHaveTextContent(/R\$\s?400,00.*2 contas em aberto/)
    expect(metric("Já pagas")).toHaveTextContent(/R\$\s?1\.200,00.*1 conta paga/)
    expect(metric("Vencidas")).toHaveTextContent(/R\$\s?300,00.*1 conta vencida/)
    expect(screen.getByText("Vencida", { selector: "span" })).toBeInTheDocument()
    expect(screen.getByText("Pendente")).toBeInTheDocument() // vence hoje: ainda pendente
    expect(nomes()).toEqual(["Energia elétrica", "Internet", "Aluguel do salão"])
    expect(within(screen.getByRole("region", { name: formatDay(HOJE) })).getByText("Internet")).toBeInTheDocument()
    await user.click(situacao("A pagar"))
    expect(nomes()).toEqual(["Energia elétrica", "Internet"])
    await user.click(situacao("Pagas"))
    expect(nomes()).toEqual(["Aluguel do salão"])
    await user.click(situacao("Vencidas"))
    expect(nomes()).toEqual(["Energia elétrica"])
  })

  it("Despesas: o calendário marca os dias com contas e clicar em um dia mostra só as contas dele", async () => {
    const user = await abrirDespesas()
    await user.click(screen.getByRole("button", { name: `${formatDay(HOJE)}, 1 conta` }))
    expect(nomes()).toEqual(["Internet"])
    await user.click(screen.getByRole("button", { name: /ver o mês todo/ }))
    expect(nomes()).toHaveLength(3)
  })

  it("Despesas: setas trocam o mês (inclusive de ano) e a leitura pede só os vencimentos daquele mês; mês vazio não inventa valores", async () => {
    const user = await abrirDespesas()
    const mes = HOJE.slice(0, 7)
    const leitura = () => api.fetchExpenseBook.mock.calls[api.fetchExpenseBook.mock.calls.length - 1]
    const ultimaLeitura = () => leitura().slice(0, 2)
    expect(ultimaLeitura()).toEqual(["loja-1", `${mes}-01`])
    api.fetchExpenseBook.mockResolvedValue({ entries: [], recurrences: [] })
    await user.click(screen.getByRole("button", { name: "Próximo mês" }))
    await waitFor(() => expect(ultimaLeitura()).toEqual(["loja-1", addMonths(HOJE, 1)]))
    expect(await screen.findByText("Nenhuma despesa neste mês")).toBeInTheDocument()
    expect(metric("Total do mês")).toHaveTextContent(/R\$\s?0,00.*Nenhuma conta neste mês/)
    expect(nomes()).toEqual([])
    for (let i = 0; i < 13; i++) await user.click(screen.getByRole("button", { name: "Mês anterior" }))
    await waitFor(() => expect(ultimaLeitura()).toEqual(["loja-1", addMonths(HOJE, -12)]))
    expect(leitura()[2]).toBe(addDays(addMonths(HOJE, -11), -1)) // último dia do mês
  })

  it("Nova despesa em outro mês: o vencimento sugerido é do mês aberto", async () => {
    const user = await abrirDespesas()
    await user.click(screen.getByRole("button", { name: "Próximo mês" }))
    await waitFor(() => expect(api.fetchExpenseBook.mock.calls[api.fetchExpenseBook.mock.calls.length - 1][1]).toBe(addMonths(HOJE, 1)))
    await user.click(await screen.findByRole("button", { name: "Nova despesa" }))
    fireEvent.change(await screen.findByLabelText(/Descrição/), { target: { value: "IPTU" } })
    await escolher(screen.getByLabelText(/Categoria/), "Impostos")
    fireEvent.change(screen.getByLabelText(/Valor/), { target: { value: "45000" } })
    api.createExpense.mockResolvedValueOnce(undefined)
    await user.click(screen.getByRole("button", { name: "Salvar despesa" }))
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledWith(expect.objectContaining({ descricao: "IPTU", valor: 45000, vencimento: addMonths(HOJE, 1) })))
  })

  it("Nova despesa: erro no próprio formulário; falha de rede preserva o que foi digitado e a nova tentativa usa o mesmo id", async () => {
    const user = await abrirDespesas()
    await user.click(screen.getByRole("button", { name: "Nova despesa" }))
    await user.click(await screen.findByRole("button", { name: "Salvar despesa" }))
    expect(screen.getByText("Informe a descrição, como Energia elétrica.")).toBeInTheDocument()
    expect(screen.getByText("Informe um valor maior que zero.")).toBeInTheDocument()
    expect(api.createExpense).not.toHaveBeenCalled()
    // corrigir o campo tira o aviso na hora, sem precisar salvar de novo
    expect(screen.getByText("Informe a categoria.")).toBeInTheDocument()
    await escolher(screen.getByLabelText(/Categoria/), "Energia")
    expect(screen.queryByText("Informe a categoria.")).not.toBeInTheDocument()
    expect(screen.getByText("Informe um valor maior que zero.")).toBeInTheDocument() // o que ainda falta continua avisado
    // categoria nova: "Outra categoria…" abre o campo de texto, e dá para voltar à lista
    await escolher(screen.getByLabelText(/Categoria/), "Outra categoria…")
    fireEvent.change(screen.getByLabelText(/Categoria/), { target: { value: "Copa" } })
    expect(screen.getByLabelText(/Categoria/)).toHaveValue("Copa")
    fireEvent.click(screen.getByRole("button", { name: "Escolher da lista" }))

    fireEvent.change(screen.getByLabelText(/Descrição/), { target: { value: "Conta de água" } })
    await escolher(screen.getByLabelText(/Categoria/), "Água")
    fireEvent.change(screen.getByLabelText(/Valor/), { target: { value: "8450" } })
    api.createExpense.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await user.click(screen.getByRole("button", { name: "Salvar despesa" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão com a internet")
    expect(screen.getByLabelText(/Descrição/)).toHaveValue("Conta de água")

    api.createExpense.mockResolvedValueOnce(undefined)
    await user.click(screen.getByRole("button", { name: "Salvar despesa" }))
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(2))
    const [primeira, segunda] = api.createExpense.mock.calls.map((c) => c[0])
    expect(segunda).toMatchObject({ shopId: "loja-1", descricao: "Conta de água", categoria: "Água", valor: 8450, vencimento: HOJE, forma: null, frequencia: null, pagoEm: null })
    expect(segunda.id).toBe(primeira.id)
    await waitFor(() => expect(screen.queryByRole("button", { name: "Salvar despesa" })).not.toBeInTheDocument())
  })

  it("Marcar como paga: erro mantém a conta pendente e relê o banco; o sucesso envia data, valor e forma", async () => {
    const user = await abrirDespesas()
    await user.click(screen.getByRole("button", { name: /Energia elétrica/ }))
    await user.click(await screen.findByRole("button", { name: "Marcar como paga" }))
    api.payExpense.mockRejectedValueOnce({ message: "expense_not_pending" })
    const leituras = api.fetchExpenseBook.mock.calls.length
    await user.click(await screen.findByRole("button", { name: "Confirmar pagamento" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Esta conta já foi paga ou não está mais em aberto.")
    await waitFor(() => expect(api.fetchExpenseBook.mock.calls.length).toBeGreaterThan(leituras))

    api.payExpense.mockResolvedValueOnce(undefined)
    await user.click(screen.getByRole("button", { name: "Confirmar pagamento" }))
    await waitFor(() => expect(api.payExpense).toHaveBeenLastCalledWith("d1", { pagoEm: HOJE, valor: 30000, forma: "pix" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirmar pagamento" })).not.toBeInTheDocument())
  })
  it("Despesas: buscar pela descrição filtra a lista do mês", async () => {
    await abrirDespesas()
    fireEvent.change(screen.getByLabelText("Buscar despesa pela descrição"), { target: { value: "inter" } })
    expect(nomes()).toEqual(["Internet"])
    fireEvent.change(screen.getByLabelText("Buscar despesa pela descrição"), { target: { value: "xyz" } })
    expect(screen.getByText("Nenhuma despesa encontrada")).toBeInTheDocument()
  })

  it("Editar conta pendente: abre preenchido e atualiza a MESMA despesa, sem criar outra", async () => {
    const user = await abrirDespesas()
    await user.click(screen.getByRole("button", { name: /Energia elétrica/ }))
    await user.click(await screen.findByRole("button", { name: "Editar" }))
    expect(await screen.findByLabelText(/Descrição/)).toHaveValue("Energia elétrica")
    fireEvent.change(screen.getByLabelText(/Valor/), { target: { value: "32550" } })
    api.updateExpense.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão com a internet")
    expect(screen.getByLabelText(/Valor/)).toHaveValue("325,50")
    api.updateExpense.mockResolvedValueOnce(undefined)
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }))
    await waitFor(() => expect(api.updateExpense).toHaveBeenLastCalledWith("d1", expect.objectContaining({ descricao: "Energia elétrica", valor: 32550 })))
    expect(api.createExpense).not.toHaveBeenCalled()
    expect(api.createExpenses).not.toHaveBeenCalled()
  })

  it("Editar conta paga: só descrição e categoria; valor e pagamento ficam fora do formulário", async () => {
    const user = await abrirDespesas()
    await user.click(screen.getByRole("button", { name: /Aluguel do salão/ }))
    await user.click(await screen.findByRole("button", { name: "Editar" }))
    fireEvent.change(await screen.findByLabelText(/Descrição/), { target: { value: "Aluguel de novembro" } })
    expect(screen.queryByLabelText(/Valor/)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Excluir despesa" })).not.toBeInTheDocument()
    api.updateExpenseDetails.mockResolvedValueOnce(undefined)
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }))
    await waitFor(() => expect(api.updateExpenseDetails).toHaveBeenCalledWith("d3", "Aluguel de novembro", "Contas fixas"))
    expect(api.updateExpense).not.toHaveBeenCalled()
  })

  it("Reverter pagamento: só na conta paga, pede confirmação, erro mantém a conta e o sucesso relê o banco", async () => {
    const user = await abrirDespesas()
    await user.click(screen.getByRole("button", { name: /Energia elétrica/ }))
    expect(await screen.findByRole("button", { name: "Marcar como paga" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reverter pagamento" })).not.toBeInTheDocument() // pendente: nada a reverter
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("button", { name: "Marcar como paga" })).not.toBeInTheDocument())

    await user.click(screen.getByRole("button", { name: /Aluguel do salão/ }))
    await user.click(await screen.findByRole("button", { name: "Reverter pagamento" }))
    expect(api.revertExpensePayment).not.toHaveBeenCalled() // só depois de confirmar
    expect(screen.getByRole("alertdialog", { name: "Confirmar reversão" })).toHaveTextContent(/R\$\s?1\.200,00.*Vencida/)
    api.revertExpensePayment.mockRejectedValueOnce({ message: "expense_not_paid" })
    await user.click(screen.getByRole("button", { name: "Confirmar reversão" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("não tem pagamento registrado para reverter")

    const leituras = api.fetchExpenseBook.mock.calls.length
    api.revertExpensePayment.mockResolvedValueOnce(undefined)
    await user.click(screen.getByRole("button", { name: "Reverter pagamento" }))
    await user.click(screen.getByRole("button", { name: "Confirmar reversão" }))
    await waitFor(() => expect(api.revertExpensePayment).toHaveBeenCalledTimes(2))
    expect(api.revertExpensePayment).toHaveBeenLastCalledWith("d3")
    await waitFor(() => expect(api.fetchExpenseBook.mock.calls.length).toBeGreaterThan(leituras))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Reverter pagamento" })).not.toBeInTheDocument())
  })

  it("Várias despesas: linha inválida é destacada, nada é enviado; uma chamada só para o lote e a nova tentativa repete os mesmos ids", async () => {
    const user = await abrirDespesas()
    await user.click(screen.getByRole("button", { name: "Nova despesa" }))
    fireEvent.change(await screen.findByLabelText(/Descrição/), { target: { value: "Aluguel" } })
    await escolher(screen.getByLabelText(/Categoria/), "Aluguel")
    fireEvent.change(screen.getByLabelText(/Valor/), { target: { value: "250000" } })
    await user.click(screen.getByRole("button", { name: "Adicionar outra despesa" }))
    expect(screen.getByText(/2 despesas ·/)).toHaveTextContent(/R\$\s?2\.500,00/)
    await user.click(screen.getByRole("button", { name: "Salvar todas (2)" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Corrija a despesa destacada")
    expect(screen.getByRole("group", { name: "Despesa 2" })).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByRole("group", { name: "Despesa 1" })).not.toHaveAttribute("aria-invalid")
    expect(api.createExpenses).not.toHaveBeenCalled()

    fireEvent.change(screen.getAllByLabelText(/Descrição/)[1], { target: { value: "Energia" } })
    await escolher(screen.getAllByLabelText(/Categoria/)[1], "Energia")
    fireEvent.change(screen.getAllByLabelText(/Valor/)[1], { target: { value: "31000" } })
    expect(screen.getByText(/2 despesas ·/)).toHaveTextContent(/R\$\s?2\.810,00/)
    api.createExpenses.mockRejectedValueOnce({ message: "invalid_expense_line:2" })
    await user.click(screen.getByRole("button", { name: "Salvar todas (2)" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("A despesa 2 foi recusada")
    expect(screen.getByRole("alert")).toHaveTextContent("Nenhuma despesa foi gravada")
    expect(screen.getByRole("group", { name: "Despesa 2" })).toHaveAttribute("aria-invalid", "true")
    expect(screen.getAllByLabelText(/Descrição/).map((i) => (i as HTMLInputElement).value)).toEqual(["Aluguel", "Energia"])

    api.createExpenses.mockResolvedValueOnce(undefined)
    await user.click(screen.getByRole("button", { name: "Salvar todas (2)" }))
    await waitFor(() => expect(api.createExpenses).toHaveBeenCalledTimes(2))
    const [primeira, segunda] = api.createExpenses.mock.calls
    expect(segunda[0]).toBe("loja-1")
    expect(segunda[1]).toMatchObject([{ descricao: "Aluguel", valor: 250000, vencimento: HOJE, frequencia: null, pagoEm: null }, { descricao: "Energia", valor: 31000 }])
    expect(segunda[1].map((i: { id: string }) => i.id)).toEqual(primeira[1].map((i: { id: string }) => i.id))
    expect(new Set(segunda[1].map((i: { id: string }) => i.id)).size).toBe(2)
    expect(api.createExpense).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole("button", { name: /Salvar todas/ })).not.toBeInTheDocument())
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
