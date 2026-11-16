/// <reference types="@testing-library/jest-dom/vitest" />
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { ThemeProvider } from "@/lib/theme"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  fetchOutbox: vi.fn(), fetchOutboxSummary: vi.fn(), fetchIntegrations: vi.fn(), fetchInbound: vi.fn(), deleteOutboxEvent: vi.fn(),
}))
vi.mock("../api", () => ({
  fetchOutbox: m.fetchOutbox, fetchOutboxSummary: m.fetchOutboxSummary, fetchIntegrations: m.fetchIntegrations, fetchInbound: m.fetchInbound, deleteOutboxEvent: m.deleteOutboxEvent,
}))
vi.mock("@/features/catalog/hooks/useActiveBarbershop", () => ({
  useActiveBarbershop: () => ({ state: "ready", retry: () => {}, isRetrying: false, active: { id: "loja-1", nome: "Barbearia", fuso: "America/Sao_Paulo", papel: "proprietario" }, canManage: true }),
}))

vi.mock("../components/PreferencesCard", () => ({ PreferencesCard: () => <div>Cartão de novidades</div> }))

import { Messages } from "./Messages"

const booking = { id: "b1", barbershop_id: "loja-1", service_id: "s1", professional_id: "p1", servico_nome: "Corte", cliente_nome: "Maria Souza", cliente_whatsapp: "11912345678", preco_centavos: 6000, inicio: "2099-01-10T12:00:00.000Z", fim: "2099-01-10T12:40:00.000Z", status: "confirmado", professionals: { nome: "Ana" } }
const row = (id: string, nome: string) => ({ id, tipo: "reserva_criada", canal: "whatsapp", destino: "11912345678", status: "bloqueado", tentativas: 0, max_tentativas: 5, ultimo_erro: null, criado_em: "2099-01-01T12:00:00.000Z", bookings: { ...booking, cliente_nome: nome } })

function open(path = "/dashboard/mensagens") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<ThemeProvider><QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Messages /></MemoryRouter></QueryClientProvider></ThemeProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  m.fetchOutbox.mockResolvedValue([row("o1", "Maria Souza"), row("o2", "João Lima")])
  m.fetchOutboxSummary.mockResolvedValue([])
  m.fetchIntegrations.mockResolvedValue([])
  m.fetchInbound.mockResolvedValue([])
  m.deleteOutboxEvent.mockResolvedValue(undefined)
})

describe("Mensagens: cards e lixeira", () => {
  it("cada linha mostra cliente, tipo do aviso, serviço, data e o estado real do envio", async () => {
    open()
    const lista = await screen.findByRole("list", { name: "Mensagens" })
    const maria = within(lista).getByRole("button", { name: /Abrir reserva de Maria Souza/ })
    expect(maria).toHaveTextContent("Confirmação da reserva")
    expect(maria).toHaveTextContent("Corte")
    expect(maria).toHaveTextContent("Bloqueada") // estado real (canal não configurado), não "enviada"
  })

  it("a lixeira pede confirmação e só então apaga aquele card", async () => {
    open()
    fireEvent.click(await screen.findByRole("button", { name: "Apagar mensagem de João Lima" }))
    expect(m.deleteOutboxEvent).not.toHaveBeenCalled()
    const dialogo = await screen.findByRole("dialog")
    expect(dialogo).toHaveTextContent("João Lima")
    expect(dialogo).toHaveTextContent("Não dá para desfazer")
    fireEvent.click(within(dialogo).getByRole("button", { name: "Apagar" }))
    await waitFor(() => expect(m.deleteOutboxEvent).toHaveBeenCalledWith("o2"))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("Manter fecha sem apagar; clicar na lixeira não abre o pop-up da reserva", async () => {
    open()
    fireEvent.click(await screen.findByRole("button", { name: "Apagar mensagem de Maria Souza" }))
    const dialogo = await screen.findByRole("dialog")
    expect(dialogo).toHaveTextContent("Apagar mensagem?")
    fireEvent.click(within(dialogo).getByRole("button", { name: "Manter" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(m.deleteOutboxEvent).not.toHaveBeenCalled()
  })

  it("mensagem em envio no servidor mostra aviso e não some", async () => {
    m.deleteOutboxEvent.mockRejectedValue(Object.assign(new Error("in_flight"), { message: "in_flight" }))
    open()
    fireEvent.click(await screen.findByRole("button", { name: "Apagar mensagem de Maria Souza" }))
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Apagar" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("sendo enviada")
  })
})


describe("Central de mensagens: canal, indicadores, filtros e respostas", () => {
  it("canal não configurado: faixa honesta, sem botão de conectar e com o logotipo do WhatsApp", async () => {
    open()
    const faixa = await screen.findByRole("region", { name: "Canal WhatsApp" })
    expect(faixa).toHaveTextContent("WhatsApp não configurado")
    expect(faixa).toHaveTextContent("Os avisos permanecem bloqueados até que a integração seja ativada no servidor.")
    expect(faixa.querySelector("svg")).toHaveAttribute("fill", "#25D366")
    expect(within(faixa).queryByRole("button")).not.toBeInTheDocument()
  })

  it("canal ativo e suspenso aparecem como tal", async () => {
    m.fetchIntegrations.mockResolvedValue([{ provider: "whatsapp", status: "ativo" }])
    open()
    expect(await screen.findByRole("region", { name: "Canal WhatsApp" })).toHaveTextContent("WhatsApp ativo")
  })

  it("os quatro indicadores vêm do resumo real do banco", async () => {
    m.fetchOutboxSummary.mockResolvedValue([{ status: "pendente", total: 3 }, { status: "enviado", total: 12 }, { status: "falhou", total: 1 }, { status: "bloqueado", total: 5 }])
    open()
    const resumo = await screen.findByRole("list", { name: "Resumo dos envios" })
    for (const [label, n] of [["Na fila", "3"], ["Enviadas", "12"], ["Falhas", "1"], ["Bloqueadas", "5"]]) expect(within(resumo).getByText(label).nextElementSibling).toHaveTextContent(n)
  })

  it("filtra por estado do envio e diferencia 'na fila' de 'enviada'", async () => {
    m.fetchOutbox.mockResolvedValue([{ ...row("o1", "Maria Souza"), status: "pendente" }, { ...row("o2", "João Lima"), status: "enviado" }, { ...row("o3", "Ana Reis"), status: "falhou", ultimo_erro: "x" }])
    open()
    const lista = await screen.findByRole("list", { name: "Mensagens" })
    expect(within(lista).getByRole("button", { name: /Abrir reserva de Maria Souza/ })).toHaveTextContent("Na fila")
    expect(within(lista).getByRole("button", { name: /Abrir reserva de João Lima/ })).toHaveTextContent("Enviada")
    fireEvent.click(screen.getByRole("button", { name: "Na fila (1)" }))
    expect(screen.getByRole("button", { name: "Na fila (1)" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("Maria Souza")).toBeInTheDocument()
    expect(screen.queryByText("João Lima")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Falhas (1)" }))
    expect(screen.getByText("Ana Reis")).toBeInTheDocument()
    expect(screen.queryByText("Maria Souza")).not.toBeInTheDocument()
  })

  it("respostas: SIM e NÃO separados, com o indicador na mensagem da reserva", async () => {
    m.fetchInbound.mockResolvedValue([
      { id: "i1", status: "processado", motivo: "sim", recebido_em: "2099-01-01T12:00:00.000Z", booking_id: "b1" },
      { id: "i2", status: "processado", motivo: "nao", recebido_em: "2099-01-01T11:00:00.000Z", booking_id: null },
      { id: "i3", status: "ignorado", motivo: "resposta_invalida", recebido_em: "2099-01-01T10:00:00.000Z", booking_id: null },
    ])
    open()
    const lista = await screen.findByRole("list", { name: "Mensagens" })
    expect(within(lista).getAllByText("Confirmou").length).toBeGreaterThan(0) // a reserva b1 tem a resposta SIM
    const respostas = screen.getByRole("heading", { name: "Respostas recebidas" }).closest("section")!
    expect(within(respostas).getByText("Cliente confirmou a presença.")).toBeInTheDocument()
    expect(within(respostas).getByText("Cliente avisou que não pode ir. A reserva continua: reagende ou cancele.")).toBeInTheDocument()
    expect(within(respostas).getByText("Resposta diferente de SIM ou NÃO.")).toBeInTheDocument()
    expect(within(respostas).getAllByText("Aplicada")).toHaveLength(2)
    expect(within(respostas).getByText("Ignorada")).toBeInTheDocument()
  })

  it("sem respostas e com o canal inativo, explica a limitação em vez de simular conversa", async () => {
    open()
    expect(await screen.findByText("As respostas só chegam depois que o WhatsApp for ativado no servidor.")).toBeInTheDocument()
  })

  it("celular e tablet: clicar na linha abre o pop-up da reserva com as ações", async () => {
    open()
    fireEvent.click(await screen.findByRole("button", { name: /Abrir reserva de Maria Souza/ }))
    const dialogo = await screen.findByRole("dialog")
    expect(dialogo).toHaveTextContent("Maria Souza")
    expect(within(dialogo).getByRole("button", { name: "Reagendar" })).toBeInTheDocument()
  })
})

describe("Central de mensagens no desktop: painel de detalhes", () => {
  const original = window.matchMedia
  beforeEach(() => { window.matchMedia = ((q: string) => ({ matches: q.includes("1280"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia })
  afterEach(() => { window.matchMedia = original })

  it("mostra a dica antes de escolher e os detalhes com as ações no painel (sem pop-up) depois", async () => {
    open()
    const painel = await screen.findByRole("complementary", { name: "Detalhes da mensagem" })
    expect(painel).toHaveTextContent("Selecione uma mensagem")
    fireEvent.click(await screen.findByRole("button", { name: /Abrir reserva de Maria Souza/ }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(within(painel).getByRole("heading", { name: "Maria Souza" })).toBeInTheDocument()
    expect(within(painel).getByText("Valor").nextElementSibling).toHaveTextContent("60,00")
    expect(within(painel).getByRole("button", { name: "Reagendar" })).toBeInTheDocument()
    expect(within(painel).getByRole("button", { name: "Cancelar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Abrir reserva de Maria Souza/ })).toHaveAttribute("aria-pressed", "true")
  })
})

describe("abas da Central", () => {
  it("duas abas: Mensagens (padrão) e Notificações, no cabeçalho compacto sem foto", async () => {
    open()
    expect(await screen.findByRole("heading", { level: 1, name: "Central de mensagens" })).toBeInTheDocument()
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Mensagens", "Notificações"])
    expect(screen.getByRole("tab", { name: "Mensagens" })).toHaveAttribute("aria-selected", "true")
    expect(document.querySelector('[data-banner="mensagens"] img')).toBeNull()
    expect(await screen.findByLabelText("Canal WhatsApp")).toBeInTheDocument() // a fila e a faixa do canal ficam na aba Mensagens
  })

  it("?aba=notificacoes abre a aba Notificações com o conteúdo vindo de Mais, sem duplicar o que está em Mensagens", async () => {
    open("/dashboard/mensagens?aba=notificacoes")
    expect(await screen.findByRole("heading", { name: "Mensagens ao cliente" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Notificações" })).toHaveAttribute("aria-selected", "true")
    expect(screen.queryByText("Automático")).not.toBeInTheDocument() // chaves no lugar do rótulo
    // chaves reais só onde existe configuração (reminder_config): confirmação e lembrete, ligadas por padrão
    expect(await screen.findByRole("switch", { name: "Enviar confirmação da reserva automaticamente" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("switch", { name: "Enviar lembrete automático automaticamente" })).toHaveAttribute("aria-checked", "true")
    // nenhum controle falso: o que ainda não sai pelo WhatsApp aparece desligado e bloqueado, com o motivo
    for (const nome of ["Cancelamento", "Reagendamento", "Atendimento concluído"]) {
      const chave = screen.getByRole("switch", { name: `${nome}: ainda não sai pelo WhatsApp` })
      expect(chave).toHaveAttribute("aria-checked", "false")
      expect(chave).toBeDisabled()
    }
    expect(screen.getByText("Indisponível")).toBeInTheDocument() // e-mail sem integração
    // sem "Avisos para você" e sem "Receber novidades"
    expect(screen.queryByText("Cartão de novidades")).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Avisos para você" })).not.toBeInTheDocument()
    // retorno do cliente: card próprio e chave na lista (desligado por padrão)
    expect(screen.getByRole("region", { name: "Retorno do cliente" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Enviar retorno do cliente automaticamente" })).toHaveAttribute("aria-checked", "false")
    // coluna direita: Canais de envio, depois o Lembrete automático, depois as regras
    const canais = screen.getByRole("heading", { name: "Canais de envio" })
    const lembrete = screen.getByText("Lembrete automático", { selector: "p.font-display" })
    const regras = screen.getByRole("region", { name: "Regras dos avisos" })
    expect(canais.compareDocumentPosition(lembrete) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(lembrete.compareDocumentPosition(regras) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByLabelText("Resumo dos envios")).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Respostas recebidas" })).not.toBeInTheDocument()
  })

  it("canal não configurado nunca aparece como ativo; canal ativo aparece como ativo", async () => {
    m.fetchIntegrations.mockResolvedValue([])
    open("/dashboard/mensagens?aba=notificacoes")
    expect(await screen.findByText("Inativo")).toBeInTheDocument()
    expect(screen.queryByText("Ativo")).not.toBeInTheDocument()
    expect(screen.getByText(/ficam bloqueados|permanecem bloqueados/)).toBeInTheDocument()
  })

  it("com o canal ativo o estado é o mesmo nas duas abas (uma definição só)", async () => {
    m.fetchIntegrations.mockResolvedValue([{ provider: "whatsapp", status: "ativo" }])
    open("/dashboard/mensagens?aba=notificacoes")
    expect(await screen.findByText("Ativo")).toBeInTheDocument()
    expect(screen.getByText("Os avisos autorizados pelos clientes são enviados automaticamente.")).toBeInTheDocument()
  })
})
