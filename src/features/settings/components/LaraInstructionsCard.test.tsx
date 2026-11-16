import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({ fetchLaraInstructions: vi.fn(), saveLaraInstructions: vi.fn() }))
vi.mock("../ai-api", () => api)
vi.mock("@/ui/sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { LaraInstructionsCard } from "./LaraInstructionsCard"

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><LaraInstructionsCard shopId="loja-1" /></QueryClientProvider>)
}

beforeEach(() => vi.clearAllMocks())

describe("Configurações › Assistente › Instruções da Lara", () => {
  it("mostra as instruções salvas da barbearia e grava a edição", async () => {
    api.fetchLaraInstructions.mockResolvedValue("Chame pelo primeiro nome.")
    api.saveLaraInstructions.mockResolvedValue(undefined)
    renderCard()
    const campo = await screen.findByLabelText("Instruções personalizadas")
    expect(campo).toHaveValue("Chame pelo primeiro nome.")
    expect(screen.getByRole("button", { name: "Salvar instruções" })).toBeDisabled() // nada mudou
    fireEvent.change(campo, { target: { value: "Mostre o total do dia no fim da agenda." } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar instruções" }))
    await waitFor(() => expect(api.saveLaraInstructions).toHaveBeenCalledWith("loja-1", "Mostre o total do dia no fim da agenda."))
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar instruções" })).toBeDisabled())
  })

  it("sem a migration 0025: avisa e não mostra o campo", async () => {
    api.fetchLaraInstructions.mockResolvedValue(null)
    renderCard()
    expect(await screen.findByText(/migration 0025/)).toBeInTheDocument()
    expect(screen.queryByLabelText("Instruções personalizadas")).not.toBeInTheDocument()
  })

  it("recusa do servidor vira mensagem clara", async () => {
    api.fetchLaraInstructions.mockResolvedValue("")
    api.saveLaraInstructions.mockRejectedValue(new Error("forbidden"))
    renderCard()
    fireEvent.change(await screen.findByLabelText("Instruções personalizadas"), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar instruções" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Só o proprietário e o gerente")
  })
})
