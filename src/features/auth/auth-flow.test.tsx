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
  finishAuthCallback: vi.fn(),
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
  finishAuthCallback: mocks.finishAuthCallback,
}))

import { routes } from "@/routes"
import { rememberNext } from "./domain"
import { toast } from "@/ui/sonner"

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
  localStorage.clear()
  listeners = new Set()
  mocks.getSession.mockResolvedValue(null)
  mocks.getCurrentUser.mockResolvedValue(SESSION.user)
  mocks.signOut.mockResolvedValue(undefined)
  mocks.fetchMyBarbershops.mockResolvedValue({ status: "unavailable" })
  mocks.finishAuthCallback.mockResolvedValue({ recovery: false })
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
    expect(router.state.location.pathname).toBe("/painel/entrar")
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
    expect(router.state.location.pathname).toBe("/painel/entrar")
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
    renderAt("/agendamentos")
    const popup = await dialog()

    fireEvent.click(within(popup).getByRole("button", { name: "Continuar com Google" }))

    await waitFor(() => expect(mocks.signInWithGoogle).toHaveBeenCalledWith("/agendamentos"))
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
    expect(router.state.location.pathname).toBe("/painel/entrar")
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

  it("conta só de cliente não entra pela porta do sistema: a sessão do PAINEL é encerrada e ela vai para a porta do cliente", async () => {
    const info = vi.spyOn(toast, "info")
    mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [{ id: "l1", nome: "Loja", slug: "loja", endereco: null, status: "ativo", papel: "cliente" }] })
    mocks.signInWithPassword.mockImplementation(async () => { mocks.getSession.mockResolvedValue(SESSION); emit("SIGNED_IN", SESSION) })
    const router = renderAt("/painel/entrar")
    const popup = await dialog()

    type("Email", "maria@b.co")
    type("Senha", "correta")
    fireEvent.click(within(popup).getByRole("button", { name: "Entrar" }))

    await waitFor(() => expect(router.state.location.pathname).toBe("/acesso"))
    expect(info).toHaveBeenCalledWith("Esta conta é de cliente. Entre pela página da barbearia para ver suas reservas.", { id: "conta-de-cliente" })
    expect(mocks.signOut).toHaveBeenCalledWith("local", "painel")
    expect(mocks.signOut).not.toHaveBeenCalledWith("local", "cliente")
  })

  it("login aceito volta ao destino protegido pedido antes", async () => {
    mocks.signInWithPassword.mockImplementation(async () => emit("SIGNED_IN", SESSION))
    const router = renderAt("/agendamentos")
    const popup = await dialog()

    type("Email", "a@b.co")
    type("Senha", "correta")
    fireEvent.click(within(popup).getByRole("button", { name: "Entrar" }))

    await waitFor(() => expect(router.state.location.pathname).toBe("/agendamentos"))
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
    type("WhatsApp", "(64) 99275-0733")
    type("Senha", "12345678")
    type("Confirmar senha", "12345678")
  }

  it("T1 — cadastro pede nome, e-mail, WhatsApp e senha, e envia o WhatsApp para a conta", async () => {
    mocks.signUp.mockResolvedValue({ needsEmailConfirmation: true })
    const { router, popup } = await openSignUp()

    fillSignUp()
    type("WhatsApp", "")
    fireEvent.click(within(popup).getByRole("button", { name: "Criar conta" }))
    expect(await within(popup).findByText("Informe o WhatsApp com DDD, como +55 11 91234-5678.")).toBeInTheDocument()
    expect(mocks.signUp).not.toHaveBeenCalled()

    type("WhatsApp", "(64) 99275-0733")
    fireEvent.click(within(popup).getByRole("button", { name: "Criar conta" }))
    expect(await within(popup).findByRole("heading", { name: "Confirme seu email" })).toBeInTheDocument()
    expect(popup).toHaveTextContent("ana@b.co")
    expect(mocks.signUp).toHaveBeenCalledWith({ nome: "Ana Lima", email: "ana@b.co", senha: "12345678", whatsapp: "64992750733" }, "/dashboard")
    expect(router.state.location.pathname).toBe("/painel/criar-conta")
  })

  it("R2 — e-mail já cadastrado orienta a entrar ou recuperar a senha, sem criar outra conta", async () => {
    mocks.signUp.mockResolvedValue({ needsEmailConfirmation: false, alreadyRegistered: true })
    const { router, popup } = await openSignUp()

    fillSignUp()
    fireEvent.click(within(popup).getByRole("button", { name: "Criar conta" }))

    expect(await within(popup).findByRole("heading", { name: "Este e-mail já tem cadastro" })).toBeInTheDocument()
    expect(popup).toHaveTextContent("ana@b.co")
    expect(within(popup).queryByRole("heading", { name: "Confirme seu email" })).not.toBeInTheDocument()
    expect(within(popup).getByRole("button", { name: "Entrar" })).toBeInTheDocument()
    fireEvent.click(within(popup).getByRole("button", { name: "Recuperar senha" }))
    expect(await within(popup).findByRole("heading", { name: "Recuperar senha" })).toBeInTheDocument()
    expect(mocks.signUp).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe("/painel/recuperar")
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
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith("ana@b.co", "/dashboard")

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
    expect(router.state.location.pathname).toBe("/painel/entrar")
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
    localStorage.setItem("barberia:auth-next", JSON.stringify({ path: "/dashboard/contas", exp: Date.now() + 60_000 }))
    mocks.getSession.mockResolvedValue(SESSION)
    at("#token_hash=h")
    const router = renderAt("/auth/callback")

    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard/contas"))
  })

  it("sem destino guardado, vai ao painel", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    at("#token_hash=h")
    const router = renderAt("/auth/callback")

    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"))
  })

  it("sem destino guardado, a conta do cliente volta para a barbearia onde foi criada", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1", user_metadata: { signup_next: "/barbearia-teste" } } })
    at("?area=cliente#token_hash=h")
    const router = renderAt("/auth/callback")

    await waitFor(() => expect(router.state.location.pathname).toBe("/barbearia-teste"))
  })

  it("link expirado volta ao popup com a explicação", async () => {
    at("#error=access_denied&error_code=otp_expired")
    renderAt("/auth/callback")

    expect(await dialog()).toHaveTextContent("Este link expirou, é inválido ou já foi usado.")
  })

  it("retorno sem sessão não falha em silêncio", async () => {
    mocks.finishAuthCallback.mockRejectedValue(new Error("token inválido"))
    at("#token_hash=invalido")
    renderAt("/auth/callback")

    expect(await dialog()).toHaveTextContent("Não foi possível concluir a autenticação.")
  })

  it("link com tokens de outra conta (fluxo implícito) não troca a sessão: volta à porta com a falha, sem concluir nada", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    at("?area=cliente&volta=%2Fbarbearia-teste#access_token=token-de-outra-conta&refresh_token=r")
    const router = renderAt("/auth/callback")

    await waitFor(() => expect(router.state.location.pathname).toBe("/barbearia-teste/entrar"))
    expect(mocks.finishAuthCallback).not.toHaveBeenCalled()
  })

  it("link de e-mail de outra conta com sessão aberta pergunta antes de trocar; continuar mantém a conta atual", async () => {
    const troca = { atual: "maria@example.test", link: "outra@example.test", confirmar: vi.fn().mockResolvedValue(undefined), cancelar: vi.fn().mockResolvedValue(undefined) }
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.finishAuthCallback.mockResolvedValue({ recovery: false, troca })
    at("?area=cliente&volta=%2Fbarbearia-teste#token_hash=h&type=email")
    const router = renderAt("/auth/callback")

    expect(await screen.findByRole("heading", { name: "Trocar de conta?" })).toBeInTheDocument()
    expect(screen.getByText(/Você está conectado como/)).toHaveTextContent("maria@example.test")
    expect(screen.getByText(/Você está conectado como/)).toHaveTextContent("outra@example.test")
    expect(router.state.location.pathname).toBe("/auth/callback")
    fireEvent.click(screen.getByRole("button", { name: "Continuar como maria@example.test" }))

    await waitFor(() => expect(router.state.location.pathname).toBe("/barbearia-teste"))
    expect(troca.cancelar).toHaveBeenCalledTimes(1)
    expect(troca.confirmar).not.toHaveBeenCalled()
  })

  it("escolher a conta do link troca a sessão e segue para o destino", async () => {
    const OUTRA = { user: { id: "user-2", user_metadata: {} } }
    const troca = { atual: "maria@example.test", link: "outra@example.test", confirmar: vi.fn(async () => emit("SIGNED_IN", OUTRA)), cancelar: vi.fn() }
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.finishAuthCallback.mockResolvedValue({ recovery: false, troca })
    at("?area=cliente&volta=%2Fbarbearia-teste#token_hash=h&type=email")
    const router = renderAt("/auth/callback")

    fireEvent.click(await screen.findByRole("button", { name: "Entrar como outra@example.test" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/barbearia-teste"))
    expect(troca.confirmar).toHaveBeenCalledTimes(1)
    expect(troca.cancelar).not.toHaveBeenCalled()
  })

  it("sem sessão, link de e-mail de conta que este navegador não pediu pergunta antes de entrar; cancelar volta à porta", async () => {
    const troca = { atual: null, link: "joao.silva@example.test", confirmar: vi.fn(), cancelar: vi.fn().mockResolvedValue(undefined) }
    mocks.finishAuthCallback.mockResolvedValue({ recovery: false, troca })
    at("?area=cliente&volta=%2Fbarbearia-teste#token_hash=h&type=email")
    const router = renderAt("/auth/callback")

    expect(await screen.findByRole("heading", { name: "Entrar com esta conta?" })).toBeInTheDocument()
    expect(screen.getByText(/Este link é da conta/)).toHaveTextContent("joao.silva@example.test")
    expect(router.state.location.pathname).toBe("/auth/callback")
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))

    await waitFor(() => expect(router.state.location.pathname).toBe("/barbearia-teste/entrar"))
    expect(router.state.location.search).toBe("")
    expect(troca.cancelar).toHaveBeenCalledTimes(1)
    expect(troca.confirmar).not.toHaveBeenCalled()
  })

  it("acesso direto sem parâmetros só abre o popup", async () => {
    at("")
    renderAt("/auth/callback")

    const popup = await dialog()
    expect(within(popup).queryByRole("alert")).not.toBeInTheDocument()
  })

  it("recuperação pedida na barbearia volta para a área do cliente dela, não para o painel", async () => {
    rememberNext("/barbearia-do-tico/minhas-reservas")
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.updatePassword.mockResolvedValue(undefined)
    at("#token_hash=h&type=recovery")
    const router = renderAt("/auth/callback")

    expect(await screen.findByRole("heading", { name: "Definir nova senha" })).toBeInTheDocument()
    type("Nova senha", "12345678")
    type("Confirmar nova senha", "12345678")
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }))
    expect(await screen.findByText("Senha alterada com sucesso. Agora você pode entrar na sua conta.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))

    await waitFor(() => expect(router.state.location.pathname).toBe("/barbearia-do-tico/minhas-reservas"))
  })

  it("recuperação pede a nova senha e depois abre o painel", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.updatePassword.mockResolvedValue(undefined)
    at("#token_hash=h&type=recovery")
    const router = renderAt("/auth/callback")

    expect(await screen.findByRole("heading", { name: "Definir nova senha" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/auth/callback")

    type("Nova senha", "curta")
    type("Confirmar nova senha", "curta")
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }))
    expect(await screen.findByText("Use pelo menos 8 caracteres.")).toBeInTheDocument()
    expect(mocks.updatePassword).not.toHaveBeenCalled()

    type("Nova senha", "12345678")
    type("Confirmar nova senha", "12345678")
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }))
    expect(await screen.findByText("Senha alterada com sucesso. Agora você pode entrar na sua conta.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))

    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"))
    expect(mocks.updatePassword).toHaveBeenCalledWith("12345678", "painel")
  })
})


describe("retorno em /auth/callback: só a área que iniciou o fluxo", () => {
  const at = (suffix: string) => window.history.replaceState(null, "", `/auth/callback${suffix}`)

  it("Google iniciado na barbearia conclui no cliente da barbearia e volta para ela", async () => {
    rememberNext("/barbearia-do-tico/minhas-reservas")
    mocks.getSession.mockResolvedValue(SESSION)
    at("?area=cliente&code=c1&sb_flow_id=f1")
    const router = renderAt("/auth/callback")

    await waitFor(() => expect(router.state.location.pathname).toBe("/barbearia-do-tico/minhas-reservas"))
    expect(mocks.finishAuthCallback).toHaveBeenCalledWith("cliente", expect.objectContaining({ code: "c1" }))
    expect(mocks.finishAuthCallback).not.toHaveBeenCalledWith("painel", expect.anything())
  })

  it("recuperação da barbearia: a nova senha é gravada na sessão do cliente", async () => {
    rememberNext("/barbearia-do-tico/minhas-reservas")
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.finishAuthCallback.mockResolvedValue({ recovery: true })
    mocks.updatePassword.mockResolvedValue(undefined)
    at("?area=cliente&tipo=recuperar&code=c2&sb_flow_id=f2")
    const router = renderAt("/auth/callback")

    expect(await screen.findByRole("heading", { name: "Definir nova senha" })).toBeInTheDocument()
    type("Nova senha", "12345678")
    type("Confirmar nova senha", "12345678")
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }))
    expect(await screen.findByText("Senha alterada com sucesso. Agora você pode entrar na sua conta.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))

    await waitFor(() => expect(router.state.location.pathname).toBe("/barbearia-do-tico/minhas-reservas"))
    expect(mocks.updatePassword).toHaveBeenCalledWith("12345678", "cliente")
  })

  it("destino guardado por um fluxo da outra área não vale: o Google do painel volta ao painel", async () => {
    rememberNext("/barbearia-do-tico/minhas-reservas") // o cliente iniciou um fluxo depois, em outra aba
    mocks.getSession.mockResolvedValue(SESSION)
    at("?area=painel&code=c4")
    const router = renderAt("/auth/callback")

    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"))
    expect(mocks.finishAuthCallback).toHaveBeenCalledWith("painel", expect.objectContaining({ code: "c4" }))
  })

  it("recuperação aberta em outro navegador ou aparelho, sem login: troca a senha na sessão temporária e NÃO entra sozinho", async () => {
    const salvar = vi.fn().mockResolvedValue(undefined)
    mocks.finishAuthCallback.mockResolvedValue({ recovery: true, recuperacao: { email: "maria@example.test", salvar } })
    at("?area=cliente&tipo=recuperar&volta=%2Fbarbearia-do-tico%2Fminhas-reservas#token_hash=pkce_h1&type=recovery")
    const router = renderAt("/auth/callback")

    expect(await screen.findByRole("heading", { name: "Definir nova senha" })).toBeInTheDocument()
    expect(mocks.finishAuthCallback).toHaveBeenCalledWith("cliente", expect.objectContaining({ tokenHash: "pkce_h1", isRecovery: true }))
    expect(window.location.search + window.location.hash).toBe("?area=cliente") // o token saiu do endereço e do histórico

    type("Nova senha", "12345678")
    type("Confirmar nova senha", "87654321")
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }))
    expect(await screen.findByText("As senhas não são iguais.")).toBeInTheDocument()
    expect(salvar).not.toHaveBeenCalled()

    type("Confirmar nova senha", "12345678")
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }))
    expect(await screen.findByText("Senha alterada com sucesso. Agora você pode entrar na sua conta.")).toBeInTheDocument()
    expect(salvar).toHaveBeenCalledWith("12345678")
    expect(mocks.updatePassword).not.toHaveBeenCalled() // nada passa pela sessão da área
    expect(router.state.location.pathname).toBe("/auth/callback") // só sai daqui por escolha

    fireEvent.click(screen.getByRole("button", { name: "Entrar na minha conta" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/barbearia-do-tico/entrar"))
  })

  it("recuperação da conta B com a conta A conectada: A continua conectada e B só entra por escolha", async () => {
    const A = { user: { id: "user-a", email: "ana@example.test", user_metadata: {} } }
    const salvar = vi.fn().mockResolvedValue(undefined)
    mocks.getSession.mockResolvedValue(A)
    mocks.finishAuthCallback.mockResolvedValue({ recovery: true, recuperacao: { email: "bia@example.test", salvar } })
    at("?area=painel&tipo=recuperar#token_hash=pkce_b&type=recovery")
    const router = renderAt("/auth/callback")

    expect(await screen.findByRole("heading", { name: "Definir nova senha" })).toBeInTheDocument()
    type("Nova senha", "12345678")
    type("Confirmar nova senha", "12345678")
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }))

    expect(await screen.findByText("Senha alterada com sucesso. Agora você pode entrar na sua conta.")).toBeInTheDocument()
    expect(screen.getByText("ana@example.test")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Sair e entrar como bia@example.test" })).toBeInTheDocument()
    expect(mocks.signOut).not.toHaveBeenCalled() // A não foi desconectada
    expect(mocks.updatePassword).not.toHaveBeenCalled() // a senha de A não foi tocada

    fireEvent.click(screen.getByRole("button", { name: "Continuar como ana@example.test" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"))
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it("recuperação da conta B com A conectada: 'Sair e entrar como B' encerra só a sessão desta área e abre o login", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-a", email: "ana@example.test", user_metadata: {} } })
    mocks.finishAuthCallback.mockResolvedValue({ recovery: true, recuperacao: { email: "bia@example.test", salvar: vi.fn().mockResolvedValue(undefined) } })
    at("?area=cliente&tipo=recuperar&volta=%2Fbarbearia-do-tico%2Fminhas-reservas#token_hash=pkce_b2&type=recovery")
    renderAt("/auth/callback")

    await screen.findByRole("heading", { name: "Definir nova senha" })
    type("Nova senha", "12345678")
    type("Confirmar nova senha", "12345678")
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }))
    fireEvent.click(await screen.findByRole("button", { name: "Sair e entrar como bia@example.test" }))
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith("local", "cliente"))
  })

  it("recuperação da própria conta A com A conectada: troca a senha e A segue conectada, sem pergunta de troca", async () => {
    const salvar = vi.fn().mockResolvedValue(undefined)
    mocks.getSession.mockResolvedValue({ user: { id: "user-a", email: "ana@example.test", user_metadata: {} } })
    mocks.finishAuthCallback.mockResolvedValue({ recovery: true, recuperacao: { email: "Ana@example.test", salvar } })
    at("?area=painel&tipo=recuperar#token_hash=pkce_a&type=recovery")
    const router = renderAt("/auth/callback")

    await screen.findByRole("heading", { name: "Definir nova senha" })
    type("Nova senha", "12345678")
    type("Confirmar nova senha", "12345678")
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }))
    await screen.findByText("Senha alterada com sucesso. Agora você pode entrar na sua conta.")
    expect(screen.queryByRole("button", { name: /Sair e entrar/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"))
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it("link de nova senha no modelo antigo (code) aberto em outro navegador: pede um link novo, sem falar em 'mesmo navegador'", async () => {
    mocks.finishAuthCallback.mockRejectedValue({ code: "pkce_code_verifier_not_found" })
    at("?area=cliente&tipo=recuperar&volta=%2Fbarbearia-do-tico%2Fminhas-reservas&code=c9")
    const router = renderAt("/auth/callback")

    await waitFor(() => expect(router.state.location.pathname).toBe("/barbearia-do-tico/entrar"))
    const popup = await dialog()
    expect(popup).toHaveTextContent("Este link de nova senha não é mais válido.")
    expect(popup).not.toHaveTextContent("mesmo navegador")
  })

  it("confirmação de cadastro aberta em outro aparelho (token_hash): entra e volta à barbearia do link", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    at("?area=cliente&tipo=cadastro&volta=%2Fbarbearia-do-tico#token_hash=pkce_h2&type=email")
    const router = renderAt("/auth/callback")

    await waitFor(() => expect(router.state.location.pathname).toBe("/barbearia-do-tico"))
    expect(mocks.finishAuthCallback).toHaveBeenCalledWith("cliente", expect.objectContaining({ tokenHash: "pkce_h2", isRecovery: false }))
  })

  it("link do e-mail expirado, inválido ou já usado volta à porta da barbearia com a opção de pedir outro", async () => {
    mocks.finishAuthCallback.mockRejectedValue({ code: "otp_expired" })
    at("?area=cliente&tipo=recuperar&volta=%2Fbarbearia-do-tico%2Fminhas-reservas#token_hash=pkce_h3&type=recovery")
    const router = renderAt("/auth/callback")

    await waitFor(() => expect(router.state.location.pathname).toBe("/barbearia-do-tico/entrar"))
    expect(await dialog()).toHaveTextContent("Este link expirou, é inválido ou já foi usado.")
  })

  it("porta de outra área gravada no link é ignorada (sem redirecionamento para fora da área)", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    at("?area=painel&tipo=cadastro&volta=%2Fbarbearia-do-tico%2Fminhas-reservas#token_hash=pkce_h4&type=email")
    const router = renderAt("/auth/callback")

    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"))
  })

  it("link de cadastro aberto em outro navegador: avisa que o e-mail foi confirmado e pede para entrar", async () => {
    mocks.finishAuthCallback.mockRejectedValue({ code: "pkce_code_verifier_not_found" })
    at("?area=cliente&tipo=cadastro&code=c3")
    const router = renderAt("/auth/callback")

    await waitFor(() => expect(router.state.location.pathname).toBe("/acesso"))
    expect(await dialog()).toHaveTextContent("E-mail confirmado. Agora entre com seu e-mail e senha.")
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
    const router = renderAt("/agendamentos")
    await waitFor(() => expect(router.state.location.pathname).toBe("/painel/entrar"))
    expect(router.state.location.search).toBe("")
  })

  it("quem só é cliente não abre telas de gestão: vai para a porta do cliente da última barbearia", async () => {
    localStorage.setItem("barberia:ultima-barbearia", "barbearia-do-tico")
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [{ id: "l1", nome: "Loja", slug: "loja", endereco: null, status: "ativo", papel: "cliente" }] })
    const router = renderAt("/financeiro")
    await waitFor(() => expect(router.state.location.pathname).toBe("/barbearia-do-tico/minhas-reservas"))
  })

  it("quem tem papel na equipe abre a gestão normalmente", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [{ id: "l1", nome: "Loja", slug: "loja", endereco: null, status: "ativo", papel: "proprietario" }] })
    const router = renderAt("/financeiro")
    await waitFor(() => expect(router.state.location.pathname).toBe("/financeiro"))
  })

  it("dono novo, sem nenhuma barbearia, não é tratado como cliente", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [] })
    const router = renderAt("/servicos")
    await waitFor(() => expect(router.state.location.pathname).toBe("/servicos"))
  })
})
