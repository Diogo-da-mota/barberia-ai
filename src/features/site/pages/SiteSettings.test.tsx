/// <reference types="@testing-library/jest-dom/vitest" />
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

const SHOP = { id: "loja-1", nome: "Barbearia", slug: "barbearia", endereco: null, status: "ativo", fuso: "America/Sao_Paulo", papel: "proprietario" }
const gate = vi.hoisted(() => ({ canManage: true, papel: "proprietario" }))
const api = vi.hoisted(() => ({
  fetchSiteProfile: vi.fn(), fetchMedia: vi.fn(), saveSiteProfile: vi.fn(), saveSiteTemplate: vi.fn(), setShopSlug: vi.fn(), uploadMedia: vi.fn(), removeMedia: vi.fn(),
  fetchPanelPhotos: vi.fn(), savePanelPhoto: vi.fn(), removePanelPhoto: vi.fn(),
  publicMediaUrl: (p: string | null | undefined) => (p ? `https://x.test/${p}` : null),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock("@/app/Shell", () => ({ Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock("@/features/catalog/hooks/useActiveBarbershop", () => ({ useActiveBarbershop: () => ({ state: "ready", active: { ...SHOP, papel: gate.papel }, canManage: gate.canManage }) }))
vi.mock("@/features/catalog/api", () => ({
  fetchServices: async () => ({ status: "ok", data: [{ id: "s1", nome: "Corte", descricao: null, preco_centavos: 6000, duracao_min: 40, ativo: true }] }),
  fetchProfessionals: async () => ({ status: "ok", data: [{ id: "p1", nome: "Ana", ativo: true, service_ids: ["s1"] }] }),
}))
vi.mock("@/features/booking/api", () => ({ getPublicShop: vi.fn().mockResolvedValue(null) }))
vi.mock("@/ui/accent-picker", () => ({ AccentPicker: () => <div role="group" aria-label="Cor de destaque" /> }))
vi.mock("@/ui/sonner", () => ({ toast }))
vi.mock("../api", () => api)

import { SiteSettings } from "./SiteSettings"

const profile = (extra: Record<string, unknown> = {}) => ({ descricao: "Cortes clássicos.", cor_destaque: "verde", endereco: "Rua A, 1", telefone: "11999990000", slug: "barbearia", ...extra })

function setup(p: Record<string, unknown> = { template: "urbano" }, path = "/dashboard/site") {
  api.fetchSiteProfile.mockResolvedValue(profile(p))
  api.fetchMedia.mockResolvedValue([{ id: "m1", kind: "capa", storage_path: "loja-1/capa.jpg", mime: "image/jpeg", tamanho_bytes: 10, criado_em: "2026-01-01" }])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><SiteSettings /></MemoryRouter></QueryClientProvider>)
}
const radio = (name: string) => screen.getByRole("radio", { name })
const saveButton = () => screen.getByRole("button", { name: /Salvar alterações|Tudo salvo|Salvando/ })
/** Abas do Radix ativam no mousedown (o clique simples do jsdom não troca). */
const openTab = (name: string) => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 })

beforeEach(() => { vi.clearAllMocks(); gate.canManage = true; gate.papel = "proprietario"; api.saveSiteTemplate.mockResolvedValue(undefined); api.fetchPanelPhotos.mockResolvedValue({ menu: null, inicio: null, agenda: null, servicos: null, financeiro: null, login: null }) })
const menuPreview = () => screen.getByRole("img", { name: "Prévia da foto do menu lateral" })
const heroPreview = (device: string) => screen.getByRole("img", { name: `Prévia do topo do Início no ${device}` })

describe("/dashboard/site", () => {
  it("mostra as seções do editor, os cinco templates e a prévia do modelo salvo", async () => {
    setup({ template: "moderno" })
    expect(await screen.findByRole("heading", { level: 1, name: "Meu site" })).toBeInTheDocument()
    await screen.findByRole("radio", { name: "Moderno" }) // o editor carrega depois do cabeçalho
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Site", "Fotos"])
    expect(screen.getByRole("tab", { name: "Site" })).toHaveAttribute("aria-selected", "true")
    for (const name of ["Template", "Marca", "Galeria de fotos", "Cores do site", "Endereço do site"]) expect(screen.getByRole("heading", { name })).toBeInTheDocument()
    expect(screen.getAllByRole("radio")).toHaveLength(5)
    expect(radio("Moderno")).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("heading", { name: "Pré-visualização — Template Moderno" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Ver site publicado/ })).toHaveAttribute("href", "/barbearia")
    expect(saveButton()).toHaveTextContent("Tudo salvo")
    expect(saveButton()).toBeDisabled()
  })

  it("trocar de template só muda o rascunho: nada é salvo até clicar em Salvar, e o sucesso só vem da resposta do servidor", async () => {
    let resolve!: () => void
    api.saveSiteTemplate.mockReturnValue(new Promise<void>((r) => { resolve = r }))
    setup()
    await screen.findByRole("radio", { name: "Clássico" })
    fireEvent.click(radio("Clássico"))
    expect(radio("Clássico")).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText("Rascunho, ainda não publicado")).toBeInTheDocument()
    expect(screen.getByText("Selecionado, não salvo")).toBeInTheDocument()
    expect(api.saveSiteTemplate).not.toHaveBeenCalled()
    fireEvent.click(saveButton())
    await waitFor(() => expect(api.saveSiteTemplate).toHaveBeenCalledWith("loja-1", "classico"))
    expect(saveButton()).toHaveTextContent("Salvando…")
    expect(toast.success).not.toHaveBeenCalled() // ainda sem resposta
    resolve()
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Site atualizado."))
    expect(api.saveSiteProfile).not.toHaveBeenCalled() // só o que mudou é enviado
  })

  it("erro do servidor aparece e não vira 'salvo'", async () => {
    api.saveSiteTemplate.mockRejectedValue({ message: "forbidden" })
    setup()
    await screen.findByRole("radio", { name: "Premium" })
    fireEvent.click(radio("Premium"))
    fireEvent.click(saveButton())
    expect(await screen.findByRole("alert")).toHaveTextContent("Você não tem permissão para esta ação.")
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("banco sem a migration 0011: dá para visualizar os modelos, mas não salvar o template", async () => {
    setup({ template: undefined })
    await screen.findByRole("radio", { name: "Urbano" })
    expect(screen.getByRole("status")).toHaveTextContent(/migration 0011/)
    fireEvent.click(radio("Minimalista"))
    expect(screen.getByRole("heading", { name: "Pré-visualização — Template Minimalista" })).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    expect(api.saveSiteTemplate).not.toHaveBeenCalled()
  })

  it("editar a descrição e salvar envia só o perfil; o endereço só o proprietário muda", async () => {
    api.saveSiteProfile.mockResolvedValue(undefined)
    setup()
    const desc = await screen.findByLabelText("Descrição")
    fireEvent.change(desc, { target: { value: "Nova descrição" } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(api.saveSiteProfile).toHaveBeenCalledWith(expect.objectContaining({ shopId: "loja-1", descricao: "Nova descrição", cor: "verde" })))
    expect(api.saveSiteTemplate).not.toHaveBeenCalled()
    expect(api.setShopSlug).not.toHaveBeenCalled()
  })

  it("endereço inválido é recusado antes de ir ao servidor; gerente não altera o endereço", async () => {
    setup()
    const slug = await screen.findByLabelText("Endereço da página")
    fireEvent.change(slug, { target: { value: "Nome Inválido!" } })
    expect(await screen.findByText("O link deve ter de 3 a 60 letras minúsculas, números e hífens.")).toBeInTheDocument()
    fireEvent.click(saveButton())
    expect(api.setShopSlug).not.toHaveBeenCalled()
  })

  it("gerente vê o editor mas o endereço fica travado", async () => {
    gate.papel = "gerente"
    setup()
    expect(await screen.findByLabelText("Endereço da página")).toBeDisabled()
    expect(screen.getByText("Só o proprietário altera o endereço.")).toBeInTheDocument()
  })

  it("?aba=fotos mostra só as fotos do painel (menu lateral e topo do Início) com a prévia real, e nada do site público", async () => {
    setup({ template: "urbano" }, "/dashboard/site?aba=fotos")
    expect(await screen.findByRole("heading", { name: "Menu lateral" })).toBeInTheDocument()
    for (const name of ["Login do cliente", "Topo do Início", "Agendamentos", "Serviços", "Financeiro"]) expect(screen.getByRole("heading", { name })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Fotos" })).toHaveAttribute("aria-selected", "true")
    expect(await screen.findAllByText("Padrão")).toHaveLength(6)
    // login do cliente: a mesma foto do pop-up, com o nome da barbearia
    const login = screen.getByRole("img", { name: "Prévia da foto do login do cliente" })
    expect(login.querySelector("[data-photo]")!.getAttribute("data-photo")).toMatch(/^https:\/\/images\.unsplash\.com\//)
    expect(login).toHaveTextContent("Barbearia")
    // Financeiro: no computador, o próprio cabeçalho; no celular, as classes do celular (sem as de tela maior)
    expect(screen.getByRole("img", { name: "Prévia do cabeçalho do Financeiro no computador" }).querySelector("img")).toHaveAttribute("src", "/images/painel-topo.jpg")
    const financePhone = screen.getByRole("img", { name: "Prévia do cabeçalho do Financeiro no celular" }).querySelector("img")!
    expect(financePhone).toHaveAttribute("src", "/images/painel-topo.jpg")
    expect(financePhone).toHaveClass("w-full", "opacity-45")
    expect(financePhone.className).not.toMatch(/sm:|lg:/)
    expect(menuPreview()).toHaveClass("dark")
    expect(menuPreview().querySelector("img")).toHaveAttribute("src", "/images/painel-menu.jpg")
    expect(menuPreview().querySelectorAll("div[class*='bg-gradient']")).toHaveLength(3) // os mesmos 3 degradês da sidebar
    for (const device of ["computador", "celular"]) {
      const hero = heroPreview(device)
      expect(hero.querySelector(".dark")).not.toBeNull()
      expect(hero.querySelector("img")).toHaveAttribute("src", "/images/painel-topo.jpg")
      expect(hero.querySelectorAll("div[class*='bg-gradient']")).toHaveLength(2) // os mesmos 2 degradês do topo do Início
      for (const [title, file] of [["Agendamentos", "banner-agenda.webp"], ["Serviços", "banner-servicos.webp"]]) {
        const banner = screen.getByRole("img", { name: `Prévia da faixa de ${title} no ${device}` })
        expect(banner.querySelector(".dark")).not.toBeNull()
        expect(banner.querySelector("img")).toHaveAttribute("src", `/images/${file}`)
        expect(banner.querySelectorAll("div[class*='bg-gradient']")).toHaveLength(1) // o mesmo degradê da faixa
      }
    }
    expect(screen.queryByRole("button", { name: /Restaurar foto padrão/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Marca" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Galeria de fotos" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Escolha um template" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: /Pré-visualização/ })).not.toBeInTheDocument() // sem prévia do site na aba Fotos
  })

  it("com foto própria, a prévia mostra a foto da barbearia e restaurar volta só aquela foto para a padrão", async () => {
    api.fetchPanelPhotos.mockResolvedValue({ menu: null, inicio: "https://x.test/loja-1/painel-inicio.jpg?v=1" })
    api.removePanelPhoto.mockResolvedValue(undefined)
    setup(undefined, "/dashboard/site?aba=fotos")
    const topo = await screen.findByRole("region", { name: "Topo do Início" })
    expect(await within(topo).findByText("Sua foto")).toBeInTheDocument()
    expect(heroPreview("computador").querySelector("img")).toHaveAttribute("src", "https://x.test/loja-1/painel-inicio.jpg?v=1")
    expect(within(screen.getByRole("region", { name: "Menu lateral" })).queryByRole("button", { name: /Restaurar foto padrão/ })).not.toBeInTheDocument()
    fireEvent.click(within(topo).getByRole("button", { name: /Restaurar foto padrão/ }))
    await waitFor(() => expect(api.removePanelPhoto).toHaveBeenCalledWith("loja-1", "inicio"))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Foto padrão restaurada."))
  })

  it("trocar foto recusa arquivo inválido sem enviar e abre o ajuste (zoom e posição) na medida daquela foto", async () => {
    setup(undefined, "/dashboard/site?aba=fotos")
    const topo = await screen.findByRole("region", { name: "Topo do Início" })
    const input = within(topo).getByLabelText("Trocar foto")
    fireEvent.change(input, { target: { files: [new File(["<svg/>"], "x.svg", { type: "image/svg+xml" })] } })
    expect(await within(topo).findByRole("alert")).toBeInTheDocument()
    fireEvent.change(input, { target: { files: [new File(["x"], "topo.jpg", { type: "image/jpeg" })] } })
    expect(await within(topo).findByRole("heading", { name: "Ajustar foto do topo" })).toBeInTheDocument()
    expect(within(topo).getByText(/Formato horizontal \(1184 × 440\)/)).toBeInTheDocument()
    fireEvent.click(within(topo).getByRole("button", { name: "Cancelar" }))
    expect(screen.queryByRole("heading", { name: "Ajustar foto do topo" })).not.toBeInTheDocument()
    const servicos = screen.getByRole("region", { name: "Serviços" })
    fireEvent.change(within(servicos).getByLabelText("Trocar foto"), { target: { files: [new File(["x"], "faixa.jpg", { type: "image/jpeg" })] } })
    expect(await within(servicos).findByText(/Formato faixa \(1136 × 160\)/)).toBeInTheDocument() // medida real da faixa de Serviços no computador
    const login = screen.getByRole("region", { name: "Login do cliente" })
    fireEvent.change(within(login).getByLabelText("Trocar foto"), { target: { files: [new File(["x"], "login.jpg", { type: "image/jpeg" })] } })
    expect(await within(login).findByText(/Formato vertical \(456 × 616\)/)).toBeInTheDocument() // área da foto no pop-up
    const financeiro = screen.getByRole("region", { name: "Financeiro" })
    fireEvent.change(within(financeiro).getByLabelText("Trocar foto"), { target: { files: [new File(["x"], "fin.jpg", { type: "image/jpeg" })] } })
    expect(await within(financeiro).findByText(/Formato faixa \(750 × 128\)/)).toBeInTheDocument()
    const menu = screen.getByRole("region", { name: "Menu lateral" })
    fireEvent.change(within(menu).getByLabelText("Trocar foto"), { target: { files: [new File(["x"], "menu.jpg", { type: "image/jpeg" })] } })
    expect(await within(menu).findByText(/Formato vertical \(256 × 540\)/)).toBeInTheDocument()
    expect(api.savePanelPhoto).not.toHaveBeenCalled()
  })

  it("trocar de aba não perde o rascunho: a descrição editada em Site continua para salvar", async () => {
    api.saveSiteProfile.mockResolvedValue(undefined)
    setup()
    fireEvent.change(await screen.findByLabelText("Descrição"), { target: { value: "Navalha e café." } })
    openTab("Fotos")
    expect(await screen.findByRole("heading", { name: "Menu lateral" })).toBeInTheDocument()
    openTab("Site")
    expect(saveButton()).toHaveTextContent("Salvar alterações")
    expect(screen.getByLabelText("Descrição")).toHaveValue("Navalha e café.")
    fireEvent.click(saveButton())
    await waitFor(() => expect(api.saveSiteProfile).toHaveBeenCalledWith(expect.objectContaining({ descricao: "Navalha e café." })))
  })

  it("barbeiro e cliente não editam o site", async () => {
    gate.canManage = false
    setup()
    expect(await screen.findByText("Área da gestão")).toBeInTheDocument()
    expect(screen.queryAllByRole("radio")).toHaveLength(0)
    expect(screen.queryAllByRole("tab")).toHaveLength(0)
  })

  it("copiar link usa o endereço salvo da barbearia", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    setup()
    fireEvent.click(await screen.findByRole("button", { name: "Copiar link do site" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/barbearia`))
    expect(await screen.findByText("Link copiado.")).toBeInTheDocument()
  })

  it("mostra o link completo que será copiado (local ou produção, conforme onde o painel está aberto)", async () => {
    setup()
    expect(await screen.findByText(`Link: ${window.location.origin}/barbearia`)).toBeInTheDocument()
  })

  it("clicar na capa abre o ajuste embutido, no formato do template escolhido, sem pop-up", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["x"], { type: "image/jpeg" }) }))
    setup()
    await screen.findByRole("radio", { name: "Premium" })
    fireEvent.click(radio("Premium"))
    expect(await screen.findByText(/No template Premium a capa fica em 3:4/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Ajustar capa" }))
    expect(await screen.findByRole("heading", { name: "Ajustar capa" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument() // embutido: a prévia continua visível ao lado
    expect(screen.getByText(/Formato 3:4/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(screen.queryByRole("heading", { name: "Ajustar capa" })).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
