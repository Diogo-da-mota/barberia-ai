/// <reference types="@testing-library/jest-dom/vitest" />

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/lib/theme"

const mocks = vi.hoisted(() => ({
  fetchMyBarbershops: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock("@/features/home/api", () => ({
  fetchMyBarbershops: mocks.fetchMyBarbershops,
}))

vi.mock("@/features/auth/services/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/auth/services/auth")>()),
  getSession: mocks.getSession,
  getCurrentUser: mocks.getCurrentUser,
  onAuthStateChange: mocks.onAuthStateChange,
  signOut: mocks.signOut,
}))

import { routes } from "./routes"

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

const SESSION = { user: { id: "user-1", user_metadata: {} } }

function httpError(status: number) {
  return Object.assign(new Error("recusado"), { status })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.onAuthStateChange.mockReturnValue({ subscription: { unsubscribe: vi.fn() } })
  mocks.fetchMyBarbershops.mockResolvedValue({ status: "unavailable" })
  mocks.getCurrentUser.mockResolvedValue(SESSION.user)
  mocks.signOut.mockResolvedValue(undefined)
})

describe("rota pública /", () => {
  it("abre a Landing Page sem sessão e sem conteúdo privado", async () => {
    mocks.getSession.mockResolvedValue(null)
    const router = renderAt("/")

    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/")
    expect(screen.queryByText("Próximos atendimentos")).not.toBeInTheDocument()
    expect(screen.queryByText("Suas barbearias")).not.toBeInTheDocument()
    expect(mocks.fetchMyBarbershops).not.toHaveBeenCalled()
  })

  it("continua na Landing Page com sessão", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    const router = renderAt("/")

    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument()
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled())
    expect(router.state.location.pathname).toBe("/")
    expect(screen.queryByText("Próximos atendimentos")).not.toBeInTheDocument()
  })
})

describe("rota protegida /dashboard", () => {
  it("sem sessão, volta à Landing Page pedindo login e guarda o destino", async () => {
    mocks.getSession.mockResolvedValue(null)
    const router = renderAt("/dashboard/agendamentos")

    await waitFor(() => expect(router.state.location.pathname).toBe("/painel/entrar"))
    expect(router.state.location.search).toBe("")
    expect(router.state.location.state).toEqual({ from: "/dashboard/agendamentos" })
    expect(screen.queryByText("Em desenvolvimento")).not.toBeInTheDocument()
  })

  it("com sessão aceita pelo servidor, mostra o painel", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    const router = renderAt("/dashboard")

    expect(await screen.findByRole("heading", { level: 2, name: "Próximos atendimentos" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/dashboard")
  })

  it("não mostra o painel antes de o servidor confirmar a sessão", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.getCurrentUser.mockReturnValue(new Promise(() => {}))
    renderAt("/dashboard")

    await waitFor(() => expect(mocks.getCurrentUser).toHaveBeenCalled())
    expect(screen.queryByText("Próximos atendimentos")).not.toBeInTheDocument()
    expect(mocks.fetchMyBarbershops).not.toHaveBeenCalled()
  })

  it.each([401, 403])("encerra a sessão local quando o servidor responde %i", async (status) => {
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.getCurrentUser.mockRejectedValue(httpError(status))
    const router = renderAt("/dashboard")

    await waitFor(() => expect(router.state.location.pathname).toBe("/painel/entrar"))
    expect(mocks.signOut).toHaveBeenCalledWith("local")
    expect(screen.queryByText("Próximos atendimentos")).not.toBeInTheDocument()
  })

  it("mantém a sessão em falha de rede, sem expulsar o usuário", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.getCurrentUser.mockRejectedValue(httpError(0))
    const router = renderAt("/dashboard")

    expect(await screen.findByRole("heading", { level: 2, name: "Próximos atendimentos" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/dashboard")
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it("não repete o painel nos destinos ainda não implementados", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    renderAt("/dashboard/agendamentos")

    expect(await screen.findByRole("heading", { level: 1, name: "Agendamentos" })).toBeInTheDocument()
    expect(screen.queryByText("Próximos atendimentos")).not.toBeInTheDocument()
  })
})

describe("demais rotas", () => {
  it("declara /login uma única vez", () => {
    const paths = JSON.stringify(routes)
    expect(paths.match(/"path":"\/?login"/g)).toHaveLength(1)
  })

  it("links antigos /?auth=… vão para a porta do sistema /painel/…, mantendo o aviso", async () => {
    mocks.getSession.mockResolvedValue(null)
    const router = renderAt("/?auth=criar-conta&erro=falha")
    await waitFor(() => expect(router.state.location.pathname).toBe("/painel/criar-conta"))
    expect(router.state.location.search).toBe("?erro=falha")
  })

  it("/login leva à Landing Page pedindo login", async () => {
    mocks.getSession.mockResolvedValue(null)
    const router = renderAt("/login")

    await waitFor(() => expect(router.state.location.pathname).toBe("/painel/entrar"))
    expect(router.state.location.search).toBe("")
  })

  it("endereços desconhecidos com mais de um nível voltam à Landing Page", async () => {
    mocks.getSession.mockResolvedValue(null)
    const router = renderAt("/agendamentos/qualquer/coisa")

    await waitFor(() => expect(router.state.location.pathname).toBe("/"))
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument()
  })

  it("um nível desconhecido é endereço de barbearia (/:slug): mostra 'Barbearia não encontrada', não a Landing", async () => {
    mocks.getSession.mockResolvedValue(null)
    const router = renderAt("/agendamentos")
    expect(await screen.findByText(/Barbearia não encontrada|Agendamento indisponível|Não foi possível carregar esta barbearia/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/agendamentos")
  })
})

describe("o painel não depende de botão: a proteção está nas rotas", () => {
  it("visitante em qualquer rota do painel vai para o login, sem ver conteúdo", async () => {
    mocks.getSession.mockResolvedValue(null)
    for (const path of ["/dashboard", "/dashboard/financeiro", "/dashboard/equipe", "/dashboard/mais"]) {
      const router = renderAt(path)
      await waitFor(() => expect(router.state.location.pathname, path).toBe("/painel/entrar"))
      expect(router.state.location.search).toBe("")
    }
  })

  it("quem só tem vínculo de cliente é devolvido à área do cliente nas telas de gestão", async () => {
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [{ id: "b1", nome: "Loja", slug: "loja", endereco: null, status: "ativo", fuso: "America/Sao_Paulo", papel: "cliente" }] })
    for (const path of ["/dashboard/financeiro", "/dashboard/equipe", "/dashboard/mensagens", "/dashboard/site"]) {
      const router = renderAt(path)
      await waitFor(() => expect(router.state.location.pathname, path).toBe("/acesso")) // porta do cliente; a sessão do painel é encerrada
    }
  })
})

describe("endereços públicos sem /e/", () => {
  it("as rotas do sistema têm prioridade sobre /:slug", async () => {
    mocks.getSession.mockResolvedValue(null)
    const acesso = renderAt("/acesso")
    expect(acesso.state.matches.slice(-1)[0]?.route.path).toBe("/acesso")
    const convite = renderAt("/convite")
    expect(convite.state.matches.slice(-1)[0]?.route.path).toBe("/convite")
    const painel = renderAt("/dashboard")
    expect(painel.state.matches.some((m) => m.route.path === "/:slug")).toBe(false)
    const reservas = renderAt("/minhas-reservas")
    expect(reservas.state.matches.slice(-1)[0]?.route.path).toBe("/minhas-reservas")
    expect(renderAt("/barbearia-do-tico").state.matches.slice(-1)[0]?.route.path).toBe("/:slug")
    expect(renderAt("/barbearia-do-tico/minhas-reservas").state.matches.slice(-1)[0]?.route.path).toBe("/:slug/minhas-reservas")
  })

  it("as seções da página têm endereço próprio com barra (/slug/servicos), sem #; outro segundo nível volta à Landing", async () => {
    mocks.getSession.mockResolvedValue(null)
    for (const s of ["servicos", "profissionais", "galeria", "contato"]) {
      const router = renderAt(`/barbearia-do-tico/${s}`)
      expect(router.state.matches.slice(-1)[0]?.route.path, s).toBe(`/:slug/${s}`)
      expect(router.state.location.pathname).toBe(`/barbearia-do-tico/${s}`)
    }
    const desconhecida = renderAt("/barbearia-do-tico/qualquer-coisa")
    await waitFor(() => expect(desconhecida.state.location.pathname).toBe("/"))
  })

  it("links antigos /e/:slug redirecionam para /:slug, com parâmetros e âncora preservados, e sem loop", async () => {
    mocks.getSession.mockResolvedValue(null)
    const a = renderAt("/e/barbearia-do-tico")
    await waitFor(() => expect(a.state.location.pathname).toBe("/barbearia-do-tico"))
    const b = renderAt("/e/barbearia-do-tico/minhas-reservas?origem=whatsapp&x=1#proximas")
    await waitFor(() => expect(b.state.location.pathname).toBe("/barbearia-do-tico/minhas-reservas"))
    expect(b.state.location.search).toBe("?origem=whatsapp&x=1")
    expect(b.state.location.hash).toBe("#proximas")
    const c = renderAt("/e/barbearia-do-tico?auth=entrar")
    await waitFor(() => expect(c.state.location.pathname).toBe("/barbearia-do-tico"))
    expect(c.state.location.search).toBe("?auth=entrar")
  })

  it("vercel.json redireciona /e/* de forma permanente (308) sem apontar para si mesmo", async () => {
    const { readFileSync } = await import("node:fs")
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8"))
    expect(cfg.redirects).toEqual([
      { source: "/e/:slug/minhas-reservas", destination: "/:slug/minhas-reservas", permanent: true },
      { source: "/e/:slug", destination: "/:slug", permanent: true },
    ])
    for (const r of cfg.redirects) expect(r.destination.startsWith("/e/")).toBe(false) // sem loop
    expect(cfg.rewrites).toEqual([{ source: "/(.*)", destination: "/index.html" }]) // o acesso direto/atualizar a página continua servindo o app
  })
})
