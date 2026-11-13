import { beforeEach, describe, expect, it, vi } from "vitest"

const supa = vi.hoisted(() => ({
  getSession: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: supa.getSession }, from: supa.from },
}))

import { fetchMyBookings } from "./api"

beforeEach(() => {
  vi.clearAllMocks()
  supa.from.mockReturnValue({ select: supa.select })
  supa.select.mockReturnValue({ eq: supa.eq })
  supa.eq.mockReturnValue({ order: supa.order })
  supa.order.mockReturnValue({ limit: supa.limit })
  supa.limit.mockResolvedValue({ data: [{ id: "r1" }], error: null })
})

describe("fetchMyBookings", () => {
  it("busca só as reservas que a conta logada fez como cliente (a equipe não recebe as da barbearia)", async () => {
    supa.getSession.mockResolvedValue({ data: { session: { user: { id: "barbeiro-joao" } } } })
    expect(await fetchMyBookings()).toEqual([{ id: "r1" }])
    expect(supa.from).toHaveBeenCalledWith("bookings")
    expect(supa.eq).toHaveBeenCalledWith("customer_id", "barbeiro-joao")
  })

  it("sem sessão não consulta o banco e devolve lista vazia", async () => {
    supa.getSession.mockResolvedValue({ data: { session: null } })
    expect(await fetchMyBookings()).toEqual([])
    expect(supa.from).not.toHaveBeenCalled()
  })

  it("propaga o erro do banco", async () => {
    supa.getSession.mockResolvedValue({ data: { session: { user: { id: "maria" } } } })
    supa.limit.mockResolvedValue({ data: null, error: new Error("falha") })
    await expect(fetchMyBookings()).rejects.toThrow("falha")
  })
})
