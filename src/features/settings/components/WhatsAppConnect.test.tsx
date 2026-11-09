import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({ connectWhatsApp: vi.fn(), getWhatsAppStatus: vi.fn(), disconnectWhatsApp: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("../whatsapp-api", () => api)
vi.mock("@/ui/sonner", () => ({ toast }))

import { useWhatsAppConnection } from "../useWhatsAppConnection"
import { WhatsAppConnect } from "./WhatsAppConnect"

const QR = "data:image/png;base64,iVBORw0KGgo="
const ALT = "QR Code para conectar WhatsApp"
const semInstancia = { provider: null, connected: false, state: "not_found", number: null, profileName: null }
const aguardando = { provider: "evolution", connected: false, state: "connecting", number: null, profileName: null }
const conectado = { provider: "evolution", connected: true, state: "open", number: "556493296649", profileName: "TICO" }

/** O mesmo uso de Mais › Dados (card Integração WhatsApp) e Mensagens › Notificações. */
function Cartao() {
  const conexao = useWhatsAppConnection("loja-1")
  return <WhatsAppConnect connection={conexao} />
}
function renderCartao() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><Cartao /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

describe("Integração WhatsApp (Evolution): botão, QR e estado", () => {
  it("enquanto consulta a conexão mostra 'Verificando conexão…', sem piscar o botão Conectar", async () => {
    let responder: (v: unknown) => void = () => {}
    api.getWhatsAppStatus.mockReturnValue(new Promise((r) => { responder = r }))
    renderCartao()
    expect(screen.getByRole("status", { name: "Verificando a conexão do WhatsApp" })).toHaveTextContent("Verificando conexão…")
    expect(screen.queryByRole("button", { name: /Conectar WhatsApp/ })).not.toBeInTheDocument()
    await act(async () => responder(conectado))
    expect(await screen.findByText("WhatsApp conectado")).toBeInTheDocument()
  })

  it("desconectado: botão vermelho; mostra o QR da barbearia e, depois da leitura, conectado com o botão verde", async () => {
    api.getWhatsAppStatus.mockResolvedValueOnce(semInstancia)
    api.connectWhatsApp.mockResolvedValue({ ...aguardando, qr: QR, pairingCode: "WZYX1234" })
    renderCartao()

    const conectar = await screen.findByRole("button", { name: /Conectar WhatsApp/ })
    expect(conectar).toHaveClass("bg-danger")
    fireEvent.click(conectar)
    expect(await screen.findByAltText(ALT)).toHaveAttribute("src", QR)
    expect(api.connectWhatsApp).toHaveBeenCalledWith("loja-1")
    expect(screen.getByText("WZYX1234")).toBeInTheDocument()

    // 3 s depois, ainda sem leitura: o QR continua
    api.getWhatsAppStatus.mockResolvedValueOnce(aguardando)
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(screen.getByAltText(ALT)).toBeInTheDocument()

    // o celular leu o QR
    api.getWhatsAppStatus.mockResolvedValue(conectado)
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(await screen.findByText("WhatsApp conectado")).toBeInTheDocument()
    expect(screen.queryByAltText(ALT)).not.toBeInTheDocument()
    expect(screen.getByText(/\+55 64 9329-6649/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Desconectar/ })).toHaveClass("bg-income")
    expect(toast.success).toHaveBeenCalledWith("WhatsApp conectado!")
  })

  it("renova o QR a cada 30 s enquanto ninguém lê", async () => {
    api.getWhatsAppStatus.mockResolvedValue(semInstancia)
    api.connectWhatsApp.mockResolvedValue({ ...aguardando, qr: QR })
    renderCartao()
    fireEvent.click(await screen.findByRole("button", { name: /Conectar WhatsApp/ }))
    await screen.findByAltText(ALT)
    api.getWhatsAppStatus.mockResolvedValue(aguardando)
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    await waitFor(() => expect(api.connectWhatsApp).toHaveBeenCalledTimes(2))
  })

  it("instância já conectada abre direto em conectado, com o botão verde e sem Conectar", async () => {
    api.getWhatsAppStatus.mockResolvedValue(conectado)
    renderCartao()
    expect(await screen.findByRole("button", { name: /Desconectar/ })).toHaveClass("bg-income")
    expect(screen.queryByRole("button", { name: /Conectar WhatsApp/ })).not.toBeInTheDocument()
  })

  it("erro do servidor (Evolution não configurada) aparece sem quebrar o card", async () => {
    api.getWhatsAppStatus.mockResolvedValue(semInstancia)
    api.connectWhatsApp.mockRejectedValue(new Error("Evolution API não configurada: EVOLUTION_API_URL."))
    renderCartao()
    fireEvent.click(await screen.findByRole("button", { name: /Conectar WhatsApp/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Evolution API não configurada")
    expect(screen.getByRole("button", { name: /Conectar WhatsApp/ })).toBeEnabled()
  })
})
