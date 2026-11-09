/// <reference types="@testing-library/jest-dom/vitest" />

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/lib/theme"

const mocks = vi.hoisted(() => ({
  fetchMyBarbershops: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  signInWithGoogle: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
}))

vi.mock("@/features/home/api", () => ({ fetchMyBarbershops: mocks.fetchMyBarbershops }))

vi.mock("@/features/auth/services/auth", () => ({
  getSession: mocks.getSession,
  getCurrentUser: mocks.getCurrentUser,
  onAuthStateChange: mocks.onAuthStateChange,
  signOut: mocks.signOut,
  signInWithGoogle: mocks.signInWithGoogle,
  signInWithPassword: mocks.signInWithPassword,
  signUp: mocks.signUp,
  requestPasswordReset: mocks.requestPasswordReset,
  updatePassword: mocks.updatePassword,
}))

import { routes } from "@/routes"

const SESSION = { user: { id: "user-1", user_metadata: {} } }
type Listener = (state: { event: string; session: unknown }) => void
let listeners: Set<Listener>

function emit(event: string, session: unknown) {
  act(() => listeners.forEach((listener) => listener({ event, session })))
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  )
  return router
}

const dialog = () => screen.findByRole("dialog")
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  listeners = new Set()
  mocks.getSession.mockResolvedValue(null)
  mocks.getCurrentUser.mockResolvedValue(SESSION.user)
  mocks.signOut.mockResolvedValue(undefined)
  mocks.fetchMyBarbershops.mockResolvedValue({ status: "unavailable" })
  mocks.onAuthStateChange.mockImplementation((listener: Listener) => {
    listeners.add(listener)
    return { subscription: { unsubscribe: () => listeners.delete(listener) } }
  })
})

afterEach(() => window.history.replaceState(null, "", "/"))

describe("popup: abrir e fechar", () => {
  it("Entrar abre o popup sem sair da Landing Page", async () => {
    const router = renderAt("/")

    fireEvent.click(await within(screen.getByRole("banner")).findByRole("button", { name: "Entrar" }))

    const popup = await dialog()
    expect(router.state.location.pathname).toBe("/")
    expect(within(popup).getByRole("heading", { name: "Entrar" })).toBeInTheDocument()
    expect(within(popup).getByRole("button", { name: "Continuar com Google" })).toBeInTheDocument()
    expect(within(popup).getByLabelText("Email")).toHaveAttribute("autocomplete", "email")
    expect(within(popup).getByLabelText("Senha")).toHaveAttribute("type", "password")
    expect(within(popup).getByRole("button", { name: "Esqueci minha senha" })).toBeInTheDocument()
    expect(within(popup).getByRole("button", { name: "Criar uma conta" })).toBeInTheDocument()
  })

  it("Criar conta abre o popup no formulário de cadastro", async () => {
    renderAt("/")

    fireEvent.click(await within(screen.getByRole("banner")).findByRole("button", { name: "Criar conta" }))

    expect(within(await dialog()).getByRole("heading", { name: "Criar conta" })).toBeInTheDocument()
  })

  it("Fechar remove o popup e limpa o endereço", async () => {
    const router = renderAt("/?auth=entrar")
    const popup = await dialog()

    fireEvent.click(within(popup).getByRole("button", { name: "Fechar" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(router.state.location.pathname).toBe("/")
    expect(router.state.location.search).toBe("")
  })

  it("Esc fecha o popup", async () => {
    renderAt("/?auth=entrar")
    const popup = await dialog()

    fireEvent.keyDown(popup, { key: "Escape" })

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("/login abre a Landing Page com o popup", async () => {
    renderAt("/login")

    expect(within(await dialog()).getByRole("heading", { name: "Entrar" })).toBeInTheDocument()
  })

  it("rota protegida sem sessão abre o popup", async () => {
    const router = renderAt("/dashboard")

    expect(await dialog()).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/")
  })

  it("/login com sessão vai direto ao painel", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    const router = renderAt("/login")

    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})

describe("Google", () => {
  it("inicia o fluxo guardando o destino pedido", async () => {
    mocks.signInWithGoogle.mockResolvedValue(undefined)
    renderAt("/dashboard/agendamentos")
    const popup = await dialog()

    fireEvent.click(within(popup).getByRole("button", { name: "Continuar com Google" }))

    await waitFor(() => expect(mocks.signInWithGoogle).toHaveBeenCalledWith("/dashboard/agendamentos"))
  })

  it("mostra a falha em vez de ficar em silêncio", async () => {
    mocks.signInWithGoogle.mockRejectedValue({ code: "desconhecido", message: "detalhe interno" })
    renderAt("/?auth=entrar")
    const popup = await dialog()

    fireEvent.click(within(popup).getByRole("button", { name: "Continuar com Google" }))

    expect(await within(popup).findByRole("alert")).toHaveTextContent("Não foi possível concluir")
    expect(popup).not.toHaveTextContent("detalhe interno")
  })
})

describe("login com email e senha", () => {
  it("valida antes de chamar o servidor e liga o erro ao campo", async () => {
    renderAt("/?auth=entrar")
    const popup = await dialog()

    fireEvent.click(within(popup).getByRole("button", { name: "Entrar" }))

    const email = within(popup).getByLabelText("Email")
    expect(await within(popup).findByText("Informe seu email.")).toBeInTheDocument()
    expect(email).toHaveAttribute("aria-invalid", "true")
    expect(email).toHaveAccessibleDescription("Informe seu email.")
    expect(within(popup).getByText("Informe sua senha.")).toBeInTheDocument()
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
  })

  it("mostra e oculta a senha", async () => {
    renderAt("/?auth=entrar")
    const popup = await dialog()
    const senha = within(popup).getByLabelText("Senha")

    fireEvent.click(within(popup).getByRole("button", { name: "Mostrar senha" }))
    expect(senha).toHaveAttribute("type", "text")

    fireEvent.click(within(popup).getByRole("button", { name: "Ocultar senha" }))
    expect(senha).toHaveAttribute("type", "password")
  })

  it("mostra senha incorreta e continua na Landing Page", async () => {
    mocks.signInWithPassword.mockRejectedValue({ code: "invalid_credentials", message: "Invalid login" })
    const router = renderAt("/?auth=entrar")
    const popup = await dialog()

    type("Email", "a@b.co")
    type("Senha", "errada")
    fireEvent.click(within(popup).getByRole("button", { name: "Entrar" }))

    expect(await within(popup).findByRole("alert")).toHaveTextContent("Email ou senha incorretos.")
    expect(router.state.location.pathname).toBe("/")
  })

  it("login aceito abre o painel", async () => {
    mocks.signInWithPassword.mockImplementation(async () => emit("SIGNED_IN", SESSION))
    const router = renderAt("/?auth=entrar")
    const popup = await dialog()

    type("Email", "a@b.co")
    type("Senha", "correta")
    fireEvent.click(within(popup).getByRole("button", { name: "Entrar" }))

    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"))
    expect(mocks.signInWithPassword).toHaveBeenCalledWith("a@b.co", "correta")
  })

  it("login aceito volta ao destino protegido pedido antes", async () => {
    mocks.signInWithPassword.mockImplementation(async () => emit("SIGNED_IN", SESSION))
    const router = renderAt("/dashboard/agendamentos")
    const popup = await dialog()

    type("Email", "a@b.co")
    type("Senha", "correta")
    fireEvent.click(within(popup).getByRole("button", { name: "Entrar" }))

    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard/agendamentos"))
  })
})

describe("criar conta", () => {
  async function openSignUp() {
    const router = renderAt("/?auth=entrar")
    const popup = await dialog()
    fireEvent.click(within(popup).getByRole("button", { name: "Criar uma conta" }))
    await within(popup).findByRole("heading", { name: "Criar conta" })
    return { router, popup }
  }

  it("valida todos os campos e volta para Entrar pelo link", async () => {
    const { popup } = await openSignUp()

    type("Senha", "curta")
    type("Confirmar senha", "outra")
    fireEvent.click(within(popup).getByRole("button", { name: "Criar conta" }))

    expect(await within(popup).findByText("Informe seu nome.")).toBeInTheDocument()
    expect(within(popup).getByText("Informe seu email.")).toBeInTheDocument()
    expect(within(popup).getByText("Use pelo menos 8 caracteres.")).toBeInTheDocument()
    expect(within(popup).getByText("As senhas não são iguais.")).toBeInTheDocument()
    expect(mocks.signUp).not.toHaveBeenCalled()

    fireEvent.click(within(popup).getByRole("button", { name: "Já tenho uma conta" }))
    expect(await within(popup).findByRole("heading", { name: "Entrar" })).toBeInTheDocument()
  })

  function fillSignUp() {
    type("Nome", "Ana Lima")
    type("Email", "ana@b.co")
    type("Senha", "12345678")
    type("Confirmar senha", "12345678")
  }

  it("com confirmação de email, pede para verificar a caixa de entrada e não entra", async () => {
    mocks.signUp.mockResolvedValue({ needsEmailConfirmation: true })
    const { router, popup } = await openSignUp()

    fillSignUp()
    fireEvent.click(within(popup).getByRole("button", { name: "Criar conta" }))

    expect(await within(popup).findByRole("heading", { name: "Confirme seu email" })).toBeInTheDocument()
    expect(popup).toHaveTextContent("ana@b.co")
    expect(mocks.signUp).toHaveBeenCalledWith({ nome: "Ana Lima", email: "ana@b.co", senha: "12345678" }, "/dashboard")
    expect(router.state.location.pathname).toBe("/")
  })

  it("com sessão criada pelo servidor, abre o painel", async () => {
    mocks.signUp.mockImplementation(async () => {
      emit("SIGNED_IN", SESSION)
      return { needsEmailConfirmation: false }
    })
    const { router, popup } = await openSignUp()

    fillSignUp()
    fireEvent.click(within(popup).getByRole("button", { name: "Criar conta" }))

    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"))
  })

  it("mostra quando o cadastro está desativado", async () => {
    mocks.signUp.mockRejectedValue({ code: "signup_disabled" })
    const { popup } = await openSignUp()

    fillSignUp()
    fireEvent.click(within(popup).getByRole("button", { name: "Criar conta" }))

    expect(await within(popup).findByRole("alert")).toHaveTextContent("O cadastro está desativado no momento.")
  })
})

describe("recuperar senha", () => {
  async function openRecover() {
    renderAt("/?auth=entrar")
    const popup = await dialog()
    fireEvent.click(within(popup).getByRole("button", { name: "Esqueci minha senha" }))
    await within(popup).findByRole("heading", { name: "Recuperar senha" })
    return popup
  }

  it("valida o email", async () => {
    const popup = await openRecover()

    fireEvent.click(within(popup).getByRole("button", { name: "Enviar instruções" }))

    expect(await within(popup).findByText("Informe seu email.")).toBeInTheDocument()
    expect(mocks.requestPasswordReset).not.toHaveBeenCalled()
  })

  it("confirma o envio com instruções e permite voltar", async () => {
    mocks.requestPasswordReset.mockResolvedValue(undefined)
    const popup = await openRecover()

    type("Email", "ana@b.co")
    fireEvent.click(within(popup).getByRole("button", { name: "Enviar instruções" }))

    expect(await within(popup).findByRole("heading", { name: "Verifique seu email" })).toBeInTheDocument()
    expect(popup).toHaveTextContent("Se houver uma conta para ana@b.co")
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith("ana@b.co")

    fireEvent.click(within(popup).getByRole("button", { name: "Voltar para Entrar" }))
    expect(await within(popup).findByRole("heading", { name: "Entrar" })).toBeInTheDocument()
  })

  it("mostra o limite de envios", async () => {
    mocks.requestPasswordReset.mockRejectedValue({ code: "over_email_send_rate_limit" })
    const popup = await openRecover()

    type("Email", "ana@b.co")
    fireEvent.click(within(popup).getByRole("button", { name: "Enviar instruções" }))

    expect(await within(popup).findByRole("alert")).toHaveTextContent("Muitos emails enviados")
  })
})

describe("sessão recusada", () => {
  it("avisa no popup e não entra em ciclo de redirecionamento", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.getCurrentUser.mockRejectedValue(Object.assign(new Error("x"), { status: 403 }))
    const router = renderAt("/dashboard")

    const popup = await dialog()
    expect(popup).toHaveTextContent("Sua sessão expirou. Entre novamente.")
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(router.state.location.pathname).toBe("/")
    expect(mocks.getCurrentUser).toHaveBeenCalledTimes(1)
  })
})

describe("sessão apagada pelo cliente Supabase durante a validação", () => {
  it("também avisa que a sessão expirou", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.getCurrentUser.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve))
      mocks.getSession.mockResolvedValue(null)
      emit("SIGNED_OUT", null)
      throw Object.assign(new Error("x"), { status: 403 })
    })
    renderAt("/dashboard")

    expect(await dialog()).toHaveTextContent("Sua sessão expirou. Entre novamente.")
  })
})

describe("retorno em /auth/callback", () => {
  const at = (suffix: string) => window.history.replaceState(null, "", `/auth/callback${suffix}`)

  it("com sessão, vai ao destino guardado", async () => {
    sessionStorage.setItem("barberia:auth-next", "/dashboard/contas")
    mocks.getSession.mockResolvedValue(SESSION)
    at("#access_token=a")
    const router = renderAt("/auth/callback")

    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard/contas"))
  })

  it("sem destino guardado, vai ao painel", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    at("#access_token=a")
    const router = renderAt("/auth/callback")

    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"))
  })

  it("link expirado volta ao popup com a explicação", async () => {
    at("#error=access_denied&error_code=otp_expired")
    renderAt("/auth/callback")

    expect(await dialog()).toHaveTextContent("Este link expirou ou já foi usado.")
  })

  it("retorno sem sessão não falha em silêncio", async () => {
    at("#access_token=invalido")
    renderAt("/auth/callback")

    expect(await dialog()).toHaveTextContent("Não foi possível concluir a autenticação.")
  })

  it("acesso direto sem parâmetros só abre o popup", async () => {
    at("")
    renderAt("/auth/callback")

    const popup = await dialog()
    expect(within(popup).queryByRole("alert")).not.toBeInTheDocument()
  })

  it("recuperação pede a nova senha e depois abre o painel", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.updatePassword.mockResolvedValue(undefined)
    at("#access_token=a&type=recovery")
    const router = renderAt("/auth/callback")

    expect(await screen.findByRole("heading", { name: "Definir nova senha" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/auth/callback")

    type("Nova senha", "curta")
    type("Confirmar senha", "curta")
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }))
    expect(await screen.findByText("Use pelo menos 8 caracteres.")).toBeInTheDocument()
    expect(mocks.updatePassword).not.toHaveBeenCalled()

    type("Nova senha", "12345678")
    type("Confirmar senha", "12345678")
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }))

    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"))
    expect(mocks.updatePassword).toHaveBeenCalledWith("12345678")
  })
})


describe("portas separadas: cliente final x gestão", () => {
  it("/minhas-reservas sem login leva ao acesso do cliente (neutro), não à landing do sistema", async () => {
    const router = renderAt("/minhas-reservas")
    await waitFor(() => expect(router.state.location.pathname).toBe("/acesso"))
    expect(await screen.findByRole("heading", { name: "Acesso do cliente" })).toBeInTheDocument()
  })

  it("/minhas-reservas sem login volta para o acesso da última barbearia visitada", async () => {
    localStorage.setItem("barberia:ultima-barbearia", "barbearia-do-tico")
    const router = renderAt("/minhas-reservas")
    await waitFor(() => expect(router.state.location.pathname).toBe("/barbearia-do-tico/minhas-reservas"))
    localStorage.clear()
  })

  it("rota de gestão sem login continua indo para a entrada do sistema", async () => {
    const router = renderAt("/dashboard/agendamentos")
    await waitFor(() => expect(router.state.location.pathname).toBe("/"))
    expect(router.state.location.search).toBe("?auth=entrar")
  })

  it("quem só é cliente não abre telas de gestão: volta para as reservas", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [{ id: "l1", nome: "Loja", slug: "loja", endereco: null, status: "ativo", papel: "cliente" }] })
    const router = renderAt("/dashboard/financeiro")
    await waitFor(() => expect(router.state.location.pathname).toBe("/minhas-reservas"))
  })

  it("quem tem papel na equipe abre a gestão normalmente", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [{ id: "l1", nome: "Loja", slug: "loja", endereco: null, status: "ativo", papel: "proprietario" }] })
    const router = renderAt("/dashboard/financeiro")
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard/financeiro"))
  })

  it("dono novo, sem nenhuma barbearia, não é tratado como cliente", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [] })
    const router = renderAt("/dashboard/servicos")
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard/servicos"))
  })
})
