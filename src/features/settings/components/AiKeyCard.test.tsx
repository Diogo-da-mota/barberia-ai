import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({ fetchAiConnection: vi.fn(), saveAiKey: vi.fn(), removeAiKey: vi.fn() }))
vi.mock("../ai-api", () => api)
vi.mock("@/ui/sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { AiKeyCard } from "./AiKeyCard"

const CHAVE = "sk-proj-chave-de-exemplo-0000000000abcd"
const conectada = { provedor: "anthropic", final: "abcd", atualizado_em: "2026-11-15T12:00:00Z" }

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><AiKeyCard shopId="loja-1" /></QueryClientProvider>)
}

beforeEach(() => vi.clearAllMocks())

describe("Configurações › Assistente › Conexão de IA", () => {
  it("sem chave: cola a chave, o servidor confere e a tela mostra só o final", async () => {
    api.fetchAiConnection.mockResolvedValue(null)
    api.saveAiKey.mockResolvedValue({ provedor: "openai", final: "abcd", atualizado_em: "2026-11-15T12:00:00Z" })
    renderCard()
    const campo = await screen.findByLabelText("Chave da API")
    expect(campo).toHaveAttribute("type", "password")
    fireEvent.change(campo, { target: { value: CHAVE } })
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }))
    await waitFor(() => expect(api.saveAiKey).toHaveBeenCalledWith("loja-1", "openai", CHAVE))
    expect(await screen.findByText("OpenAI conectada")).toBeInTheDocument()
    expect(screen.getByText(/••••abcd/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(CHAVE)
  })

  it("chave recusada pelo provedor: explica e não conecta", async () => {
    api.fetchAiConnection.mockResolvedValue(null)
    api.saveAiKey.mockRejectedValue(new Error("key_rejected"))
    renderCard()
    fireEvent.change(await screen.findByLabelText("Chave da API"), { target: { value: CHAVE } })
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("O provedor recusou esta chave")
    expect(screen.queryByText(/conectada/)).not.toBeInTheDocument()
  })

  it("conectada: mostra o provedor e permite desconectar", async () => {
    api.fetchAiConnection.mockResolvedValue(conectada)
    api.removeAiKey.mockResolvedValue(null)
    renderCard()
    expect(await screen.findByText("Anthropic conectada")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }))
    await waitFor(() => expect(api.removeAiKey).toHaveBeenCalledWith("loja-1"))
    expect(await screen.findByLabelText("Chave da API")).toBeInTheDocument()
  })
})
