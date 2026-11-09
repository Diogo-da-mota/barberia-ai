// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { ACCENTS, accentStyle, applySeo, buildMediaPath, contrastRatio, seoFor, validateImage } from "./domain"

describe("cores permitidas do site", () => {
  it("todas mantêm contraste mínimo de 4,5:1 entre fundo de destaque e texto", () => {
    for (const [name, accent] of Object.entries(ACCENTS)) {
      expect(contrastRatio(accent.primary, accent.foreground), name).toBeGreaterThanOrEqual(4.5)
    }
  })
  it("gera as variáveis CSS só para cores da lista; o resto usa o padrão", () => {
    // o Tailwind v4 resolve --color-primary na raiz: sobrescrever só --primary não pinta botões nem selos
    expect(accentStyle("azul")).toEqual({
      "--primary": ACCENTS.azul.primary, "--primary-foreground": ACCENTS.azul.foreground,
      "--color-primary": ACCENTS.azul.primary, "--color-primary-foreground": ACCENTS.azul.foreground,
    })
    expect(accentStyle(null)).toBeUndefined()
    expect(accentStyle("#ff00ff")).toBeUndefined()
  })
  it("calcula contraste conhecido", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0)
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5)
  })
})

describe("upload de imagens", () => {
  it("aceita jpeg, png e webp até 2 MB", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) expect(validateImage({ type, size: 1000 })).toBeNull()
    expect(validateImage({ type: "image/png", size: 2 * 1024 * 1024 })).toBeNull()
  })
  it("recusa SVG, GIF, PDF, arquivo vazio e arquivo grande", () => {
    expect(validateImage({ type: "image/svg+xml", size: 100 })).toMatch(/JPEG, PNG ou WebP/)
    expect(validateImage({ type: "image/gif", size: 100 })).toMatch(/JPEG, PNG ou WebP/)
    expect(validateImage({ type: "application/pdf", size: 100 })).toMatch(/JPEG, PNG ou WebP/)
    expect(validateImage({ type: "image/png", size: 0 })).toMatch(/vazio/)
    expect(validateImage({ type: "image/png", size: 2 * 1024 * 1024 + 1 })).toMatch(/2 MB/)
  })
  it("monta caminhos dentro da pasta da barbearia, com extensão pelo tipo real", () => {
    const shop = "00000000-0000-4000-8000-0000000000a1"
    expect(buildMediaPath(shop, "logo", "image/png", "abc123")).toBe(`${shop}/logo-abc123.png`)
    expect(buildMediaPath(shop, "galeria", "image/jpeg", "x")).toBe(`${shop}/galeria-x.jpg`)
    expect(buildMediaPath(shop, "capa", "image/webp", "y")).toBe(`${shop}/capa-y.webp`)
  })
})

describe("SEO da página pública", () => {
  it("usa descrição própria e limita o tamanho", () => {
    expect(seoFor({ nome: "Barbearia A", descricao: "Cortes clássicos", endereco: null }).description).toBe("Cortes clássicos")
    expect(seoFor({ nome: "Barbearia A", descricao: "x".repeat(400), endereco: null }).description.length).toBeLessThanOrEqual(160)
    expect(seoFor({ nome: "Barbearia A", descricao: null, endereco: "Rua A, 10" }).description).toBe("Agende seu horário na Barbearia A. Rua A, 10")
    expect(seoFor({ nome: "Barbearia A", descricao: null, endereco: null }).title).toBe("Barbearia A | Agende online")
  })
  it("aplica título e meta tags sem duplicar", () => {
    applySeo(document, { title: "T1", description: "D1" })
    applySeo(document, { title: "T2", description: "D2", image: "https://x.test/a.png" })
    expect(document.title).toBe("T2")
    expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1)
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe("D2")
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe("T2")
    expect(document.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe("https://x.test/a.png")
  })
})
