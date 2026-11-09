import { beforeEach, describe, expect, it } from "vitest"
import {
  authErrorMessage,
  consumeNext,
  parseAuthCallback,
  rememberNext,
  safeNext,
  validateLogin,
  validateNewPassword,
  validateRecover,
  validateSignUp,
} from "./domain"

describe("safeNext", () => {
  it.each(["/dashboard", "/dashboard/agendamentos", "/dashboard/contas?mes=1"])("aceita %s", (path) => {
    expect(safeNext(path)).toBe(path)
  })

  it.each([
    undefined,
    null,
    "",
    "/",
    "/login",
    "//evil.example",
    "https://evil.example/dashboard",
    "/\\evil.example",
    "/dashboard/../login",
    "/dashboard\\..\\login",
  ])("troca %s por /dashboard", (path) => {
    expect(safeNext(path)).toBe("/dashboard")
  })
})

describe("safeNext e as páginas das barbearias na raiz", () => {
  it("aceita /slug e /slug/minhas-reservas (com consulta ou âncora) e os links antigos /e/slug", () => {
    for (const path of ["/barbearia-do-tico", "/barbearia-do-tico/minhas-reservas", "/barbearia-do-tico/minhas-reservas?x=1", "/barbearia-do-tico/servicos", "/barbearia-do-tico/contato?x=1", "/barbearia-do-tico?auth=entrar", "/barbearia-do-tico#servicos", "/dashboardx", "/e/barbearia-do-tico"]) {
      expect(safeNext(path), path).toBe(path)
    }
  })

  it("recusa palavras reservadas, caminhos com mais níveis e letras maiúsculas", () => {
    for (const path of ["/login", "/auth/callback", "/acesso", "/site", "/api", "/barbearia/outra/coisa", "/barbearia-do-tico/outra", "/BARBEARIA", "/-ruim", "/ruim-"]) {
      expect(safeNext(path), path).toBe("/dashboard")
    }
  })
})

describe("rememberNext e consumeNext", () => {
  beforeEach(() => sessionStorage.clear())

  it("devolve o destino guardado uma única vez", () => {
    rememberNext("/dashboard/contas")
    expect(consumeNext()).toBe("/dashboard/contas")
    expect(consumeNext()).toBe("/dashboard")
  })

  it("não confia em destino adulterado no navegador", () => {
    sessionStorage.setItem("barberia:auth-next", "https://evil.example")
    expect(consumeNext()).toBe("/dashboard")
  })
})

describe("validações", () => {
  it("login exige email válido e senha", () => {
    expect(validateLogin({ email: "", senha: "" })).toEqual({
      email: "Informe seu email.",
      senha: "Informe sua senha.",
    })
    expect(validateLogin({ email: "sem-arroba", senha: "x" }).email).toBe("Informe um email válido.")
    expect(validateLogin({ email: "a@b.co", senha: "x" })).toEqual({})
  })

  it("cadastro exige nome, email, senha de 8 caracteres e confirmação igual", () => {
    expect(validateSignUp({ nome: " ", email: "x", senha: "1234567", confirmacao: "" })).toEqual({
      nome: "Informe seu nome.",
      email: "Informe um email válido.",
      senha: "Use pelo menos 8 caracteres.",
      confirmacao: "Confirme sua senha.",
    })
    expect(validateSignUp({ nome: "Ana", email: "a@b.co", senha: "12345678", confirmacao: "87654321" }).confirmacao).toBe(
      "As senhas não são iguais."
    )
    expect(validateSignUp({ nome: "Ana", email: "a@b.co", senha: "12345678", confirmacao: "12345678" })).toEqual({})
  })

  it("recuperação exige email válido", () => {
    expect(validateRecover({ email: "" }).email).toBe("Informe seu email.")
    expect(validateRecover({ email: "a@b.co" })).toEqual({})
  })

  it("nova senha segue a mesma regra do cadastro", () => {
    expect(validateNewPassword({ senha: "curta", confirmacao: "curta" }).senha).toBe("Use pelo menos 8 caracteres.")
    expect(validateNewPassword({ senha: "12345678", confirmacao: "12345678" })).toEqual({})
  })
})

describe("authErrorMessage", () => {
  it.each([
    ["invalid_credentials", "Email ou senha incorretos."],
    ["over_email_send_rate_limit", "Muitos emails enviados em pouco tempo. Aguarde alguns minutos e tente de novo."],
  ])("traduz %s", (code, message) => {
    expect(authErrorMessage({ code })).toBe(message)
  })

  it("avisa sobre falha de conexão", () => {
    expect(authErrorMessage({ name: "AuthRetryableFetchError", status: 0 })).toBe(
      "Sem conexão com o servidor. Verifique sua internet e tente de novo."
    )
  })

  it("nunca repassa a mensagem interna", () => {
    expect(authErrorMessage({ code: "desconhecido", message: "detalhe interno" })).toBe(
      "Não foi possível concluir. Tente novamente."
    )
  })
})

describe("parseAuthCallback", () => {
  it("reconhece retorno de recuperação de senha", () => {
    expect(parseAuthCallback("#access_token=a&type=recovery", "")).toEqual({
      error: null,
      isRecovery: true,
      hasAuthParams: true,
    })
  })

  it("reconhece link expirado", () => {
    expect(parseAuthCallback("#error=access_denied&error_code=otp_expired", "").error).toBe("link-expirado")
  })

  it("reconhece erro do provedor na query", () => {
    expect(parseAuthCallback("", "?error=server_error&error_description=x").error).toBe("falha")
  })

  it("não vê parâmetros em um acesso direto", () => {
    expect(parseAuthCallback("", "")).toEqual({ error: null, isRecovery: false, hasAuthParams: false })
  })
})
