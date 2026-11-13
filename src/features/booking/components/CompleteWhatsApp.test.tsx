import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Banco simulado: perfil sem WhatsApp (entrou com Google) e uma reserva manual que só bate depois de salvar o número
const s = vi.hoisted(() => ({
  whatsapp: null as string | null,
  bookings: [] as { id: string }[],
  linkNext: 0,
  rpc: vi.fn(),
  success: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "maria" } } } }) },
    from: (table: string) => table === "profiles"
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { whatsapp: s.whatsapp }, error: null }) }) }) }
      : { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: s.bookings, error: null }) }) }) }) },
    rpc: s.rpc,
  },
}))
vi.mock("@/features/auth/hooks/useAuth", () => ({ useAuth: () => ({ session: { user: { id: "maria" } }, loading: false }) }))
vi.mock("@/ui/sonner", () => ({ toast: { success: s.success, error: vi.fn() } }))

import { fetchMyBookings } from "../api"
import { CompleteWhatsApp } from "./CompleteWhatsApp"

function Reservas() {
  const q = useQuery({ queryKey: ["my-bookings"], queryFn: fetchMyBookings })
  return <p>{q.data ? `reservas: ${q.data.length}` : "carregando"}</p>
}

beforeEach(() => {
  s.whatsapp = null
  s.bookings = []
  s.linkNext = 0
  s.success.mockClear()
  s.rpc.mockReset().mockImplementation(async (name: string, args?: { p_whatsapp: string }) => {
    if (name === "fill_my_whatsapp") {
      s.whatsapp = s.whatsapp ?? args!.p_whatsapp // como no banco: só preenche se estiver vazio
      s.linkNext = 1
      return { data: null, error: null }
    }
    const n = s.linkNext // link_my_bookings
    s.linkNext = 0
    if (n) s.bookings = [{ id: "manual-1" }]
    return { data: n, error: null }
  })
})

describe("recuperar reservas feitas pela barbearia", () => {
  it("R1 — conta Google sem WhatsApp informa o número, e as reservas da barbearia aparecem com aviso", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><CompleteWhatsApp /><Reservas /></QueryClientProvider>)

    expect(await screen.findByRole("heading", { name: "Complete seu cadastro" })).toBeInTheDocument()
    expect(await screen.findByText("reservas: 0")).toBeInTheDocument()
    expect(s.success).not.toHaveBeenCalledWith(expect.stringContaining("Encontramos"))

    fireEvent.change(screen.getByLabelText("WhatsApp"), { target: { value: "64992750733" } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))

    await waitFor(() => expect(s.rpc).toHaveBeenCalledWith("fill_my_whatsapp", { p_whatsapp: "64992750733" }))
    expect(await screen.findByText("reservas: 1")).toBeInTheDocument()
    expect(s.success).toHaveBeenCalledWith("Encontramos 1 reserva feita pela barbearia e ela já está na sua conta.")
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Complete seu cadastro" })).not.toBeInTheDocument())
  })
})
