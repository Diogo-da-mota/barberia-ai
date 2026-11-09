// @vitest-environment node
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { ACCENTS, ACCENT_KEYS, effectiveAccent, isAccent, isAccentChoice } from "./accent"

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }

const css = readFileSync("src/index.css", "utf8")
const LIGHT = ["#FFFFFF", "#F1F1EC"] // card e fundo do tema claro
const DARK = ["#111214", "#09090B"] // card e fundo do tema escuro

describe("cores de destaque do site inteiro", () => {
  it("só aceita as cores conhecidas; 'padrao' é uma escolha válida", () => {
    expect(ACCENT_KEYS).toEqual(["ambar", "azul", "verde", "vermelho", "violeta"])
    expect(isAccent("azul")).toBe(true)
    expect(isAccent("#ff00ff")).toBe(false)
    expect(isAccentChoice("padrao")).toBe(true)
    expect(isAccentChoice("rosa")).toBe(false)
  })

  it("o texto do botão tem contraste mínimo de 4,5:1 em cada cor", () => {
    for (const [name, a] of Object.entries(ACCENTS)) expect(contrast(a.primary, a.foreground), name).toBeGreaterThanOrEqual(4.5)
  })

  it("a cor de link é legível (≥ 4,5:1) no tema claro e no escuro, sobre o card e o fundo", () => {
    for (const [name, a] of Object.entries(ACCENTS)) {
      for (const bg of LIGHT) expect(contrast(a.linkLight, bg), `${name} claro ${bg}`).toBeGreaterThanOrEqual(4.5)
      for (const bg of DARK) expect(contrast(a.linkDark, bg), `${name} escuro ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("o index.css repete exatamente os valores de accent.ts (sem deriva), para o claro e o escuro", () => {
    for (const key of ACCENT_KEYS.filter((k) => k !== "ambar")) {
      const a = ACCENTS[key]
      expect(css, key).toContain(`html[data-accent="${key}"] { --primary: ${a.primary}; --primary-foreground: ${a.foreground}; --link: ${a.linkLight}; }`)
      expect(css, key).toContain(`html.dark[data-accent="${key}"] { --link: ${a.linkDark}; }`)
    }
  })

  it("o âmbar é o padrão do sistema (mesmos valores do :root e do .dark)", () => {
    expect(css).toContain(`--primary: ${ACCENTS.ambar.primary};`)
    expect(css).toContain(`--link: ${ACCENTS.ambar.linkLight};`)
    expect(css).toContain(`--link: ${ACCENTS.ambar.linkDark};`)
  })

  it("vale a escolha do usuário; sem escolha, a cor da barbearia; 'padrao' ignora a da barbearia", () => {
    expect(effectiveAccent("verde", "azul")).toBe("verde")
    expect(effectiveAccent(null, "azul")).toBe("azul")
    expect(effectiveAccent("padrao", "azul")).toBeNull()
    expect(effectiveAccent(null, null)).toBeNull()
  })
})
