/// <reference types="@testing-library/jest-dom/vitest" />
import { readFileSync, existsSync } from "node:fs"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PAGE_BANNERS, PageBanner } from "./page-banner"

describe("faixa fotográfica no topo das páginas", () => {
  it("tem no máximo 110px no celular, 130px no tablet e 160px no desktop (só no tema escuro)", () => {
    const { container } = render(<PageBanner name="agenda" />)
    const el = container.firstElementChild as HTMLElement
    expect(el.dataset.banner).toBe("agenda")
    expect(el.className).toContain("[.dark_&]:h-[110px]")
    expect(el.className).toContain("sm:[.dark_&]:h-[130px]")
    expect(el.className).toContain("lg:[.dark_&]:h-[160px]")
  })

  it("é decorativa (aria-hidden, sem texto alternativo) e o título passado em children continua legível", () => {
    const { container } = render(<PageBanner name="reservas"><h1>Minhas reservas</h1></PageBanner>)
    const deco = container.querySelector("[aria-hidden='true']")
    expect(deco).not.toBeNull()
    expect(deco!.querySelector("img")).toHaveAttribute("alt", "")
    expect(screen.getByRole("heading", { name: "Minhas reservas" })).toBeInTheDocument()
  })

  it("só mostra a foto no tema escuro; no claro fica escondida (o texto continua)", () => {
    const { container } = render(<PageBanner name="agenda" />)
    const deco = container.querySelector("[aria-hidden='true']") as HTMLElement
    expect(deco.className).toContain("hidden")
    expect(deco.className).toContain("[.dark_&]:block")
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
