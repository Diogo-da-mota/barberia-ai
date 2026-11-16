import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({ fetchAiConnection: vi.fn(), askAssistant: vi.fn() }))
vi.mock("../ai-api", () => api)

import { AssistantChat } from "./AssistantChat"

const conectada = { provedor: "openai", final: "abcd", atualizado_em: "2026-11-15T12:00:00Z" }

function renderChat(client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  return render(<QueryClientProvider client={client}><AssistantChat shopId="loja-1" /></QueryClientProvider>)
}
const ask = (text: string) => {
  fireEvent.change(screen.getByLabelText("Pergunta para a Lara"), { target: { value: text } })
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }))
}

beforeEach(() => vi.clearAllMocks())

describe("Configurações › Assistente › chat", () => {
  it("sem chave de IA: pede para conectar e não mostra o campo", async () => {
    api.fetchAiConnection.mockResolvedValue(null)
    renderChat()
    expect(await screen.findByText(/Conecte uma chave de IA/)).toBeInTheDocument()
    expect(screen.queryByLabelText("Pergunta para a Lara")).not.toBeInTheDocument()
  })

  it("pergunta, mostra a resposta e manda o histórico na pergunta seguinte", async () => {
    api.fetchAiConnection.mockResolvedValue(conectada)
    api.askAssistant.mockResolvedValueOnce("Hoje há 2 reservas: • 09:00 Maria").mockResolvedValueOnce("Amanhã há 1 reserva.")
    renderChat()
    await screen.findByLabelText("Pergunta para a Lara")
    ask("Quais os agendamentos de hoje?")
    expect(await screen.findByText(/Hoje há 2 reservas/)).toBeInTheDocument()
    expect(api.askAssistant).toHaveBeenCalledWith("loja-1", [{ role: "user", content: "Quais os agendamentos de hoje?" }])
    ask("E amanhã?")
    expect(await screen.findByText("Amanhã há 1 reserva.")).toBeInTheDocument()
    expect(api.askAssistant).toHaveBeenLastCalledWith("loja-1", [
      { role: "user", content: "Quais os agendamentos de hoje?" },
      { role: "assistant", content: "Hoje há 2 reservas: • 09:00 Maria" },
      { role: "user", content: "E amanhã?" },
    ])
  })

  it("erro do provedor: explica e devolve a pergunta ao campo", async () => {
    api.fetchAiConnection.mockResolvedValue(conectada)
    api.askAssistant.mockRejectedValue(new Error("rate_limited"))
    renderChat()
    await screen.findByLabelText("Pergunta para a Lara")
    ask("Faturamento do mês?")
    expect(await screen.findByRole("alert")).toHaveTextContent("sem crédito")
    await waitFor(() => expect(screen.getByLabelText("Pergunta para a Lara")).toHaveValue("Faturamento do mês?"))
  })

  it("a conversa continua ao trocar de tela (botão flutuante e Configurações usam a mesma)", async () => {
    api.fetchAiConnection.mockResolvedValue(conectada)
    api.askAssistant.mockResolvedValueOnce("Hoje há 2 reservas.")
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const tela = renderChat(client)
    await screen.findByLabelText("Pergunta para a Lara")
    ask("Agenda de hoje?")
    expect(await screen.findByText("Hoje há 2 reservas.")).toBeInTheDocument()
    tela.unmount() // outra página do painel
    renderChat(client)
    expect(await screen.findByText("Hoje há 2 reservas.")).toBeInTheDocument()
    expect(screen.getByText("Agenda de hoje?")).toBeInTheDocument()
  })

  it("primeiro uso: a Lara se apresenta e os atalhos enviam a pergunta completa", async () => {
    api.fetchAiConnection.mockResolvedValue(conectada)
    api.askAssistant.mockResolvedValueOnce("Hoje há 2 reservas.")
    renderChat()
    fireEvent.click(await screen.findByRole("button", { name: "Agenda de hoje" }))
    await waitFor(() => expect(api.askAssistant).toHaveBeenCalledWith("loja-1", [{ role: "user", content: "Quais os agendamentos de hoje?" }]))
    expect(await screen.findByText("Hoje há 2 reservas.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Agenda de hoje" })).not.toBeInTheDocument() // atalhos só na conversa vazia
  })
})
