/// <reference types="@testing-library/jest-dom/vitest" />
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/lib/theme"

const mocks = vi.hoisted(() => ({
  fetchMyBarbershops: vi.fn(),
  fetchMyBookings: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}))

vi.mock("@/features/auth/services/auth", () => ({
  getSession: mocks.getSession,
  onAuthStateChange: mocks.onAuthStateChange,
  signOut: vi.fn(),
}))
vi.mock("@/features/home/api", () => ({ fetchMyBarbershops: mocks.fetchMyBarbershops }))
vi.mock("../api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../api")>()), fetchMyBookings: mocks.fetchMyBookings }))

import { MyBookings } from "./MyBookings"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ user: { id: "u1", user_metadata: {} } })
  mocks.onAuthStateChange.mockReturnValue({ subscription: { unsubscribe: vi.fn() } })
  mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [] })
  mocks.fetchMyBookings.mockResolvedValue([])
})

describe("/minhas-reservas", () => {
  it("usa o layout do painel: sidebar e header fixos, só o conteúdo rola", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter><MyBookings /></MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>
    )
    expect(await screen.findByRole("heading", { level: 1, name: "Minhas reservas" })).toBeInTheDocument()
    expect(screen.getAllByRole("navigation", { name: "Navegação principal" }).length).toBeGreaterThan(0)
    expect(screen.getByRole("banner", { name: "Cabeçalho do painel" })).toBeInTheDocument()
    expect(screen.getByRole("main").className).toMatch(/overflow-y-auto/)
  })
})
