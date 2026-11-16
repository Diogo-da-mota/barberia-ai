/// <reference types="@testing-library/jest-dom/vitest" />
import { readFileSync, existsSync } from "node:fs"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PAGE_BANNERS, PageBanner } from "./page-banner"

describe("faixa fotográfica no topo das páginas", () => {
  it("tem no máximo 110px no celular, 130px no tablet e 160px no desktop (só no tema escuro)", () => {
    const { container } = render(<PageBanner name="agenda" photo={null} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.dataset.banner).toBe("agenda")
    expect(el.className).toContain("[.dark_&]:h-[110px]")
    expect(el.className).toContain("sm:[.dark_&]:h-[130px]")
    expect(el.className).toContain("lg:[.dark_&]:h-[160px]")
  })

  it("é decorativa (aria-hidden, sem texto alternativo) e o título passado em children continua legível", () => {
    const { container } = render(<PageBanner name="reservas" photo={null}><h1>Minhas reservas</h1></PageBanner>)
    const deco = container.querySelector("[aria-hidden='true']")
    expect(deco).not.toBeNull()
    expect(deco!.querySelector("img")).toHaveAttribute("alt", "")
    expect(screen.getByRole("heading", { name: "Minhas reservas" })).toBeInTheDocument()
  })

  it("só mostra a foto no tema escuro; no claro fica escondida (o texto continua)", () => {
    const { container } = render(<PageBanner name="agenda" photo={null} />)
    const deco = container.querySelector("[aria-hidden='true']") as HTMLElement
    expect(deco.className).toContain("hidden")
    expect(deco.className).toContain("[.dark_&]:block")
  })

  it("foto da barbearia no lugar da padrão, com o mesmo enquadramento e degradê; carregando não pisca a padrão", () => {
    const img = (photo: string | null | undefined) => render(<PageBanner name="servicos" photo={photo} />).container.querySelector("img")
    expect(img(null)).toHaveAttribute("src", "/images/banner-servicos.webp")
    const custom = img("https://x.test/loja-1/painel-servicos.jpg?v=1")!
    expect(custom).toHaveAttribute("src", "https://x.test/loja-1/painel-servicos.jpg?v=1")
    expect(custom).toHaveClass("object-cover", "opacity-90")
    expect(custom.style.objectPosition).toBe("center 38%")
    expect(custom.nextElementSibling).toHaveClass("bg-gradient-to-t", "from-background", "via-background/45", "to-background/5")
    expect(img(undefined)).toBeNull()
  })

  it("as três fotos existem no projeto em WebP e pesam pouco", () => {
    for (const [name, banner] of Object.entries(PAGE_BANNERS)) {
      const file = `public${banner.src}`
      expect(banner.src.endsWith(".webp"), name).toBe(true)
      expect(existsSync(file), file).toBe(true)
      expect(readFileSync(file).length, file).toBeLessThan(150 * 1024)
    }
  })
})
