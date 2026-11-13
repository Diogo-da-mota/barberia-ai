import { beforeEach, describe, expect, it, vi } from "vitest"

const auth = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}))

const cliente = vi.hoisted(() => ({ signOut: vi.fn(), exchangeCodeForSession: vi.fn(), setSession: vi.fn(), updateUser: vi.fn(), verifyOtp: vi.fn() }))
const area = vi.hoisted(() => ({ value: "painel" }))

vi.mock("@/lib/supabase", () => ({
  supabase: { auth },
  authClients: { painel: { auth }, cliente: { auth: cliente } },
  currentArea: () => area.value,
  CALLBACK_PATH: "/auth/callback",
}))

import { finishAuthCallback, requestPasswordReset, signInWithGoogle, signInWithPassword, signOut, signUp, updatePassword } from "./auth"

const CALLBACK = `${window.location.origin}/auth/callback?area=painel`

beforeEach(() => {
  vi.clearAllMocks()
  area.value = "painel"
  sessionStorage.clear()
  localStorage.clear()
})

describe("serviços de autenticação", () => {
  it("Google volta para a origem atual e guarda o destino", async () => {
    auth.signInWithOAuth.mockResolvedValue({ error: null })

    await signInWithGoogle("/dashboard/contas")

    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: CALLBACK } })
    expect(JSON.parse(localStorage.getItem("barberia:auth-next")!)).toMatchObject({ path: "/dashboard/contas" })
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
    expect(payload.options.emailRedirectTo).toBe(`${CALLBACK}&tipo=cadastro&volta=%2Fdashboard`)
    expect(payload.options.data).toEqual({ full_name: "Ana", signup_next: "/dashboard" })
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

  it("R2 — e-mail que já tem conta: avisa em vez de esperar uma confirmação que não chega (não cria outra conta)", async () => {
    // com a confirmação ligada, o Supabase responde sem erro e sem identidades quando o e-mail já existe
    auth.signUp.mockResolvedValue({ data: { session: null, user: { identities: [] } }, error: null })
    await expect(signUp({ nome: "Maria", email: "maria@b.co", senha: "12345678", whatsapp: "64992750733" })).resolves.toEqual({
      needsEmailConfirmation: false, alreadyRegistered: true,
    })
    // conta nova continua pedindo confirmação
    auth.signUp.mockResolvedValue({ data: { session: null, user: { identities: [{ id: "1" }] } }, error: null })
    await expect(signUp({ nome: "Maria", email: "maria@b.co", senha: "12345678" })).resolves.toEqual({ needsEmailConfirmation: true })
  })

  it("recuperação volta para a origem atual", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null })

    await requestPasswordReset("a@b.co")

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("a@b.co", { redirectTo: `${CALLBACK}&tipo=recuperar&volta=%2Fdashboard` })
  })

  it("nova senha atualiza o usuário da sessão", async () => {
    auth.updateUser.mockResolvedValue({ error: null })

    await updatePassword("12345678")

    expect(auth.updateUser).toHaveBeenCalledWith({ password: "12345678" })
  })
})

describe("duas sessões: painel e cliente", () => {
  it("o link de retorno leva a área que iniciou o fluxo", async () => {
    area.value = "cliente"
    auth.resetPasswordForEmail.mockResolvedValue({ error: null })
    await requestPasswordReset("maria@b.co", "/barbearia-do-tico/minhas-reservas")
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("maria@b.co", { redirectTo: `${window.location.origin}/auth/callback?area=cliente&tipo=recuperar&volta=%2Fbarbearia-do-tico%2Fminhas-reservas` })
  })

  it("sair encerra só a sessão da área, neste navegador", async () => {
    cliente.signOut.mockResolvedValue({ error: null })
    await signOut(undefined, "cliente")
    expect(cliente.signOut).toHaveBeenCalledWith({ scope: "local" })
    expect(auth.signOut).not.toHaveBeenCalled() // a sessão do painel continua
  })

  it("o código do retorno é trocado só no cliente da área, uma única vez", async () => {
    cliente.exchangeCodeForSession.mockResolvedValue({ data: { redirectType: "recovery" }, error: null })
    const input = { code: "codigo-1", tokens: null }
    const [a, b] = await Promise.all([finishAuthCallback("cliente", input), finishAuthCallback("cliente", input)])
    expect(a).toEqual({ recovery: true })
    expect(b).toBe(a)
    expect(cliente.exchangeCodeForSession).toHaveBeenCalledTimes(1)
    expect(cliente.exchangeCodeForSession).toHaveBeenCalledWith("codigo-1")
  })

  it("link do e-mail (token_hash) é verificado só no cliente da área, uma única vez, sem precisar do navegador original", async () => {
    cliente.verifyOtp.mockResolvedValue({ data: {}, error: null })
    const input = { code: null, tokenHash: "pkce_h1", isRecovery: true, tokens: null }
    const [a, b] = await Promise.all([finishAuthCallback("cliente", input), finishAuthCallback("cliente", input)])
    expect(a).toEqual({ recovery: true })
    expect(b).toBe(a)
    expect(cliente.verifyOtp).toHaveBeenCalledTimes(1)
    expect(cliente.verifyOtp).toHaveBeenCalledWith({ token_hash: "pkce_h1", type: "recovery" })
    expect(cliente.exchangeCodeForSession).not.toHaveBeenCalled()

    await finishAuthCallback("cliente", { code: null, tokenHash: "pkce_h2", isRecovery: false, tokens: null })
    expect(cliente.verifyOtp).toHaveBeenLastCalledWith({ token_hash: "pkce_h2", type: "email" }) // confirmação de cadastro
  })

  it("link do e-mail expirado ou já usado repassa o erro do servidor", async () => {
    cliente.verifyOtp.mockResolvedValue({ data: {}, error: { code: "otp_expired" } })
    await expect(finishAuthCallback("cliente", { code: null, tokenHash: "pkce_h3", tokens: null })).rejects.toMatchObject({ code: "otp_expired" })
  })

  it("sem o verificador PKCE (link aberto em outro navegador) repassa o erro", async () => {
    cliente.exchangeCodeForSession.mockResolvedValue({ data: {}, error: { code: "pkce_code_verifier_not_found" } })
    await expect(finishAuthCallback("cliente", { code: "codigo-2", tokens: null })).rejects.toMatchObject({ code: "pkce_code_verifier_not_found" })
  })
})
