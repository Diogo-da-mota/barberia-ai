import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { RESERVED_SLUGS, SHOP_SECTIONS, isReservedSlug, isShopSection, shopBookingsPath, shopPath, shopSectionPath, shopUrl } from "./shopPaths"

describe("endereços públicos sem /e/", () => {
  it("monta os caminhos com o slug na raiz", () => {
    expect(shopPath("barbearia-do-tico")).toBe("/barbearia-do-tico")
    expect(shopBookingsPath("barbearia-do-tico")).toBe("/barbearia-do-tico/minhas-reservas")
    expect(shopSectionPath("barbearia-do-tico", "servicos")).toBe("/barbearia-do-tico/servicos")
    expect(shopSectionPath("barbearia-do-tico", "contato")).not.toContain("#")
    expect(shopUrl("barbearia-do-tico")).toBe(`${window.location.origin}/barbearia-do-tico`)
    expect(shopPath("a b")).toBe("/a%20b") // nunca confia no texto do slug
  })

  it("palavras do sistema são reservadas, em qualquer caixa e com espaços", () => {
    for (const slug of ["dashboard", "login", "auth", "acesso", "convite", "minhas-reservas", "e", "site", "site-albuns", "api", "Dashboard", " login "]) expect(isReservedSlug(slug), slug).toBe(true)
    for (const slug of ["barbearia-do-tico", "estilo-e-cia", "dashboard-barber", "meu-site"]) expect(isReservedSlug(slug), slug).toBe(false)
  })

  it("a lista no navegador é a mesma do banco (migration 0014): sem deriva", () => {
    const sql = readFileSync("supabase/migrations/0014_slugs_reservados.sql", "utf8")
    const array = /array\[([^\]]+)\]/.exec(sql)![1]
    const inSql = [...array.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
    expect(inSql).toEqual([...RESERVED_SLUGS].sort())
  })

  it("todas as palavras reservadas respeitam o formato de slug (senão a reserva seria inútil)", () => {
    for (const w of RESERVED_SLUGS) expect(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(w), w).toBe(true)
  })

  it("só as quatro seções da página têm endereço próprio", () => {
    expect([...SHOP_SECTIONS]).toEqual(["servicos", "profissionais", "galeria", "contato"])
    for (const x of SHOP_SECTIONS) expect(isShopSection(x)).toBe(true)
    for (const x of ["minhas-reservas", "dashboard", "", undefined, "SERVICOS"]) expect(isShopSection(x as string | undefined)).toBe(false)
  })
})
