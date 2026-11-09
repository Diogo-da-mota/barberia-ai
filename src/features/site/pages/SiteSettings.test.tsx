/// <reference types="@testing-library/jest-dom/vitest" />
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

const SHOP = { id: "loja-1", nome: "Barbearia", slug: "barbearia", endereco: null, status: "ativo", fuso: "America/Sao_Paulo", papel: "proprietario" }
const gate = vi.hoisted(() => ({ canManage: true, papel: "proprietario" }))
const api = vi.hoisted(() => ({
  fetchSiteProfile: vi.fn(), fetchMedia: vi.fn(), saveSiteProfile: vi.fn(), saveSiteTemplate: vi.fn(), setShopSlug: vi.fn(), uploadMedia: vi.fn(), removeMedia: vi.fn(),
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

function setup(p: Record<string, unknown> = { template: "urbano" }) {
  api.fetchSiteProfile.mockResolvedValue(profile(p))
  api.fetchMedia.mockResolvedValue([{ id: "m1", kind: "capa", storage_path: "loja-1/capa.jpg", mime: "image/jpeg", tamanho_bytes: 10, criado_em: "2026-01-01" }])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter><SiteSettings /></MemoryRouter></QueryClientProvider>)
}
const radio = (name: string) => screen.getByRole("radio", { name })
const saveButton = () => screen.getByRole("button", { name: /Salvar alterações|Tudo salvo|Salvando/ })

beforeEach(() => { vi.clearAllMocks(); gate.canManage = true; gate.papel = "proprietario"; api.saveSiteTemplate.mockResolvedValue(undefined) })

describe("/dashboard/site", () => {
  it("mostra as seções do editor, os cinco templates e a prévia do modelo salvo", async () => {
    setup({ template: "moderno" })
    expect(await screen.findByRole("heading", { level: 1, name: "Meu site" })).toBeInTheDocument()
    await screen.findByRole("radio", { name: "Moderno" }) // o editor carrega depois do cabeçalho
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

  it("barbeiro e cliente não editam o site", async () => {
    gate.canManage = false
    setup()
    expect(await screen.findByText("Área da gestão")).toBeInTheDocument()
    expect(screen.queryAllByRole("radio")).toHaveLength(0)
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
    expect(screen.getByText(/No template Premium a capa fica em 3:4/)).toBeInTheDocument()
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
