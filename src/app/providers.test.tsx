import { act, render } from "@testing-library/react"
import { type QueryClient } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"

type AuthEvent = { event: string; session: { access_token: string } | null; user: { id: string; last_sign_in_at?: string } | null }
type Listener = ((e: AuthEvent) => void) & { area?: string }
const auth = vi.hoisted(() => ({ listeners: [] as Listener[] }))

vi.mock("@/features/auth/services/auth", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  signOut: vi.fn(),
  saveAccentPreference: vi.fn(),
  onAuthStateChange: (cb: Listener, area: string) => {
    cb.area = area
    auth.listeners.push(cb)
    return { subscription: { unsubscribe: () => { auth.listeners = auth.listeners.filter((l) => l !== cb) } } }
  },
}))

import { signOut } from "@/features/auth/services/auth"
import { AppProviders, useApp } from "./providers"

/** Sem `area`, a mesma conta nas duas áreas. A aba de teste está no painel (endereço "/"). */
const emitir = (user: string | null, area?: string) =>
  act(async () => {
    for (const l of [...auth.listeners]) if (!area || l.area === area) l({ event: user ? "SIGNED_IN" : "SIGNED_OUT", session: null, user: user ? { id: user } : null })
  })

function montar(): QueryClient {
  let client: QueryClient | undefined
  function Captura() {
    client = useApp().queryClient
    return null
  }
  render(<AppProviders><Captura /></AppProviders>)
  return client!
}

describe("troca de conta no mesmo aparelho", () => {
  it("ao sair ou entrar com outra conta, os dados da conta anterior somem; renovar o token da mesma conta mantém", async () => {
    const client = montar()
    await emitir("maria") // sessão inicial
    client.setQueryData(["my-bookings"], [{ id: "reserva-da-maria" }])

    await emitir("maria") // renovação do token da mesma conta
    expect(client.getQueryData(["my-bookings"])).toEqual([{ id: "reserva-da-maria" }])

    await emitir(null) // Maria saiu
    expect(client.getQueryData(["my-bookings"])).toBeUndefined()

    client.setQueryData(["my-bookings"], [{ id: "reserva-da-maria" }])
    await emitir("pedro") // Pedro entrou no mesmo aparelho
    expect(client.getQueryData(["my-bookings"])).toBeUndefined()
  })
})

describe("duas sessões no mesmo navegador", () => {
  it("login ou saída do cliente (outra aba) não apaga os dados do painel aberto nesta aba", async () => {
    auth.listeners = []
    const client = montar()
    await emitir("dono", "painel")
    await emitir(null, "cliente")
    client.setQueryData(["agenda"], [{ id: "atendimento" }])

    await emitir("maria", "cliente")
    await emitir(null, "cliente")
    expect(client.getQueryData(["agenda"])).toEqual([{ id: "atendimento" }])

    await emitir(null, "painel") // o dono saiu do painel
    expect(client.getQueryData(["agenda"])).toBeUndefined()
  })
})

describe("login salvo por 30 dias", () => {
  const diasAtras = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString()
  const entrar = (last_sign_in_at: string) =>
    act(async () => {
      for (const l of [...auth.listeners]) l({ event: "TOKEN_REFRESHED", session: null, user: { id: "maria", last_sign_in_at } })
    })

  it("com menos de 30 dias desde a última entrada, continua logado", async () => {
    vi.mocked(signOut).mockClear()
    montar()
    await entrar(diasAtras(29))
    expect(signOut).not.toHaveBeenCalled()
  })

  it("passados 30 dias desde a última entrada, sai sozinho (só neste aparelho)", async () => {
    vi.mocked(signOut).mockClear().mockResolvedValue(undefined)
    montar()
    await entrar(diasAtras(31))
    expect(signOut).toHaveBeenCalledWith("local", "painel")
    expect(signOut).toHaveBeenCalledWith("local", "cliente")
  })

  it("o prazo é de cada sessão: um login recente em outra área não estende a sessão antiga", async () => {
    vi.mocked(signOut).mockClear().mockResolvedValue(undefined)
    montar()
    const token = (dias: number) => `x.${btoa(JSON.stringify({ amr: [{ method: "password", timestamp: Math.floor((Date.now() - dias * 86_400_000) / 1000) }] }))}.y`
    await act(async () => {
      // conta entrou hoje (last_sign_in_at), mas ESTA sessão é de 31 dias atrás
      for (const l of [...auth.listeners]) l({ event: "TOKEN_REFRESHED", session: { access_token: token(31) } as never, user: { id: "maria", last_sign_in_at: diasAtras(0) } })
    })
    expect(signOut).toHaveBeenCalledWith("local", expect.any(String))
  })
})
