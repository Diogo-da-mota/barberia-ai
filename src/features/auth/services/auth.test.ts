import { beforeEach, describe, expect, it, vi } from "vitest"

const auth = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({ supabase: { auth } }))

import { requestPasswordReset, signInWithGoogle, signInWithPassword, signUp, updatePassword } from "./auth"

const CALLBACK = `${window.location.origin}/auth/callback`

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

describe("serviços de autenticação", () => {
  it("Google volta para a origem atual e guarda o destino", async () => {
    auth.signInWithOAuth.mockResolvedValue({ error: null })

    await signInWithGoogle("/dashboard/contas")

    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: CALLBACK } })
    expect(sessionStorage.getItem("barberia:auth-next")).toBe("/dashboard/contas")
  })

  it("repassa o erro do Google", async () => {
    auth.signInWithOAuth.mockResolvedValue({ error: { code: "provider_disabled" } })

    await expect(signInWithGoogle("/dashboard")).rejects.toMatchObject({ code: "provider_disabled" })
  })

  it("login usa email e senha informados", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: null })

    await signInWithPassword("a@b.co", "segredo")

    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "a@b.co", password: "segredo" })
  })

  it("cadastro envia só o nome de exibição, sem papel ou permissão", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null, user: { identities: [] } }, error: null })

    await signUp({ nome: "Ana", email: "a@b.co", senha: "12345678" }, "/dashboard")

    const payload = auth.signUp.mock.calls[0][0]
    expect(payload.options.emailRedirectTo).toBe(CALLBACK)
    expect(payload.options.data).toEqual({ full_name: "Ana" })
    expect(JSON.stringify(payload)).not.toMatch(/role|papel|admin|barbershop/i)
  })

  it("cadastro informa quando a confirmação de email é necessária", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null, user: {} }, error: null })
    await expect(signUp({ nome: "A", email: "a@b.co", senha: "12345678" }, "/dashboard")).resolves.toEqual({
      needsEmailConfirmation: true,
    })

    auth.signUp.mockResolvedValue({ data: { session: { access_token: "x" }, user: {} }, error: null })
    await expect(signUp({ nome: "A", email: "a@b.co", senha: "12345678" }, "/dashboard")).resolves.toEqual({
      needsEmailConfirmation: false,
    })
  })

  it("recuperação volta para a origem atual", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null })

    await requestPasswordReset("a@b.co")

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("a@b.co", { redirectTo: CALLBACK })
  })

  it("nova senha atualiza o usuário da sessão", async () => {
    auth.updateUser.mockResolvedValue({ error: null })

    await updatePassword("12345678")

    expect(auth.updateUser).toHaveBeenCalledWith({ password: "12345678" })
  })
})
