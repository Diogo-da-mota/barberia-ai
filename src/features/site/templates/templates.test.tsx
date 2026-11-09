/// <reference types="@testing-library/jest-dom/vitest" />
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SiteRenderer, TEMPLATE_IDS, TEMPLATE_INFO, isTemplateId, type SiteView } from "."
import { paletteStyle } from "./palette"

const view: SiteView = {
  nome: "Barbearia do Tico", descricao: "Cortes clássicos.", endereco: "Rua das Flores, 120", telefone: "11999990000",
  logoUrl: null, capaUrl: "https://x.test/capa.jpg", galeriaUrls: ["https://x.test/g1.jpg", "https://x.test/g2.jpg", "https://x.test/g3.jpg"],
  services: [
    { id: "s1", nome: "Corte", descricao: "Tesoura ou máquina", preco_centavos: 6000, duracao_min: 40, photos: ["https://x.test/s1.jpg"] },
    { id: "s2", nome: "Barba", descricao: null, preco_centavos: 4500, duracao_min: 30, photos: [] },
  ],
  professionals: [{ id: "p1", nome: "Ana", service_ids: ["s1"], avatar_path: null }, { id: "p2", nome: "Bruno", service_ids: ["s2"], avatar_path: null }],
}
const empty: SiteView = { ...view, services: [], professionals: [], galeriaUrls: [], telefone: null, endereco: null, descricao: null }

describe("modelos de site", () => {
  it("são cinco, com nome e descrição, e só aceita ids conhecidos", () => {
    expect(TEMPLATE_IDS).toEqual(["urbano", "classico", "minimalista", "moderno", "premium"])
    expect(TEMPLATE_IDS.map((id) => TEMPLATE_INFO[id].nome)).toEqual(["Urbano", "Clássico", "Minimalista", "Moderno", "Premium"])
    expect(isTemplateId("moderno")).toBe(true)
    expect(isTemplateId("inventado")).toBe(false)
    expect(isTemplateId(undefined)).toBe(false)
  })

  it.each(TEMPLATE_IDS)("%s: mostra os dados reais e usa o MESMO contrato de reserva (Reservar <serviço>)", (id) => {
    const onReserve = vi.fn(); const onOpenService = vi.fn()
    const { container } = render(<SiteRenderer template={id} view={view} onReserve={onReserve} onOpenService={onOpenService} />)
    expect(screen.getByRole("heading", { level: 1, name: "Barbearia do Tico" })).toBeInTheDocument()
    for (const heading of ["Serviços", "Profissionais", "Galeria", "Contato"]) expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument()
    expect(screen.getAllByText("Ana").length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Rua das Flores, 120/).length).toBeGreaterThan(0)
    expect(screen.getAllByAltText(/Foto \d de Barbearia do Tico/)).toHaveLength(3)
    expect(container.querySelector(`[data-template="${id}"]`)).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Reservar Corte" }))
    expect(onReserve).toHaveBeenCalledWith("s1")
    fireEvent.click(screen.getByRole("button", { name: "Reservar Barba" }))
    expect(onReserve).toHaveBeenLastCalledWith("s2")
    expect(onReserve).toHaveBeenCalledTimes(2) // um clique, uma reserva: nenhum modelo dispara a reserva por conta própria
  })

  it.each(TEMPLATE_IDS)("%s: sem serviços, equipe, galeria e contatos, só mostra o que existe (sem seções vazias nem dados inventados)", (id) => {
    render(<SiteRenderer template={id} view={empty} onReserve={vi.fn()} onOpenService={vi.fn()} />)
    expect(screen.getByRole("heading", { level: 1, name: "Barbearia do Tico" })).toBeInTheDocument()
    for (const heading of ["Serviços", "Profissionais", "Galeria"]) expect(screen.queryByRole("heading", { name: heading })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Reservar/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Rua das Flores/)).not.toBeInTheDocument()
  })

  it("na prévia o nome vira h2 (a tela já tem um h1)", () => {
    render(<SiteRenderer template="premium" view={view} onReserve={vi.fn()} onOpenService={vi.fn()} headingLevel={2} />)
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 2, name: "Barbearia do Tico" })).toBeInTheDocument()
  })

  it("modelo desconhecido ou ausente cai no Urbano", () => {
    const { container, rerender } = render(<SiteRenderer template={undefined} view={view} onReserve={vi.fn()} onOpenService={vi.fn()} />)
    expect(container.querySelector('[data-template="urbano"]')).not.toBeNull()
    rerender(<SiteRenderer template="qualquer" view={view} onReserve={vi.fn()} onOpenService={vi.fn()} />)
    expect(container.querySelector('[data-template="urbano"]')).not.toBeNull()
  })

  it("os cinco layouts são realmente diferentes (estrutura, não só cor)", () => {
    const shapes = TEMPLATE_IDS.map((id) => {
      const { container, unmount } = render(<SiteRenderer template={id} view={view} onReserve={vi.fn()} onOpenService={vi.fn()} />)
      // estrutura sem texto, classes de cor nem estilos: só a árvore de tags e quantos elementos de cada tipo
      const tags = [...container.querySelectorAll("*")].map((el) => el.tagName).join(",")
      unmount()
      return tags
    })
    expect(new Set(shapes).size).toBe(5)
  })

  it("cada modelo tem a própria paleta, e a cor de destaque não faz parte dela", () => {
    const styles = TEMPLATE_IDS.map((id) => paletteStyle(id) as Record<string, string>)
    expect(new Set(styles.map((s) => s["--background"])).size).toBe(5)
    for (const s of styles) { expect(s["--color-background"]).toBe(s["--background"]); expect("--primary" in s).toBe(false) }
  })

  it("a cor de destaque da barbearia é aplicada por cima da paleta", () => {
    const { container } = render(<SiteRenderer template="classico" accent="azul" view={view} onReserve={vi.fn()} onOpenService={vi.fn()} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.getPropertyValue("--primary")).toBe("#3B82F6")
    expect(root.style.getPropertyValue("--background")).toBe("#F5EFE3")
  })
})

describe("recorte por modelo", () => {
  it("cada modelo define o formato da capa e se a logo é redonda; a saída tem o lado maior em 1800 px", async () => {
    const { TEMPLATE_SLOTS, capaSize } = await import("./slots")
    expect(TEMPLATE_SLOTS.premium.capaAspect).toBeLessThan(1) // retrato
    expect(TEMPLATE_SLOTS.minimalista.capaAspect).toBeGreaterThan(2) // faixa larga
    expect(TEMPLATE_SLOTS.classico.logoRound).toBe(true)
    expect(TEMPLATE_SLOTS.urbano.logoRound).toBe(false)
    expect(capaSize(2)).toEqual({ width: 1800, height: 900 })
    expect(capaSize(3 / 4)).toEqual({ width: 1350, height: 1800 })
  })
})

describe("links de seção na página publicada", () => {
  it("o clique rola até a seção e a barra de endereços mostra /slug/secao, sem #", () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const replace = vi.spyOn(window.history, "replaceState")
    render(<SiteRenderer template="urbano" basePath="/barbearia-do-tico" view={view} onReserve={vi.fn()} onOpenService={vi.fn()} />)
    const link = screen.getAllByRole("link", { name: "Serviços" }).find((a) => a.getAttribute("href") === "#servicos")!
    fireEvent.click(link)
    expect(scroll).toHaveBeenCalled()
    expect(replace.mock.calls.slice(-1)[0][2]).toBe("/barbearia-do-tico/servicos")
    fireEvent.click(screen.getAllByRole("link", { name: "Contato" }).find((a) => a.getAttribute("href") === "#contato")!)
    expect(replace.mock.calls.slice(-1)[0][2]).toBe("/barbearia-do-tico/contato")
    replace.mockRestore()
  })

  it("na prévia (sem basePath) os links ficam como âncoras e nada mexe na URL", () => {
    const replace = vi.spyOn(window.history, "replaceState")
    render(<SiteRenderer template="urbano" view={view} onReserve={vi.fn()} onOpenService={vi.fn()} />)
    fireEvent.click(screen.getAllByRole("link", { name: "Serviços" })[0])
    expect(replace).not.toHaveBeenCalled()
    replace.mockRestore()
  })
})
