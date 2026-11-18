// @vitest-environment node
//
// Dependências das Edge Functions (P4): todo import remoto com versão exata (nada de faixa como "@2", que muda a cada
// publicação), nenhum pacote vindo de CDN que recompila o código (esm.sh) e o supabase-js na mesma versão revisada do front
// (a instalada pelo package-lock). As funções rodam com a service_role e os segredos de todas as barbearias.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const arquivos = (dir: string): string[] =>
  readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    return statSync(caminho).isDirectory() ? arquivos(caminho) : caminho.endsWith(".ts") ? [caminho] : []
  })
const IMPORT = /(?:from|import)\s*\(?\s*['"]((?:https?:\/\/|npm:|jsr:)[^'"]+)['"]/g
const remotos = arquivos("supabase/functions").flatMap((arquivo) =>
  [...readFileSync(arquivo, "utf8").matchAll(IMPORT)].map((m) => ({ arquivo, spec: m[1] })),
)
const versao = (spec: string) => spec.match(/@(\d[^/@]*)(?:\/|$)/)?.[1] ?? null
const SUPABASE_JS = JSON.parse(readFileSync("node_modules/@supabase/supabase-js/package.json", "utf8")).version as string

describe("dependências das Edge Functions", () => {
  it("existem imports remotos para conferir", () => {
    expect(remotos.length).toBeGreaterThan(10)
  })

  it("todo import remoto tem versão exata (x.y.z)", () => {
    expect(remotos.filter((r) => !/^\d+\.\d+\.\d+$/.test(versao(r.spec) ?? ""))).toEqual([])
  })

  it("nenhum pacote vem do esm.sh", () => {
    expect(remotos.filter((r) => r.spec.includes("esm.sh"))).toEqual([])
  })

  it("supabase-js é o mesmo do front (versão do package-lock), pelo registro npm", () => {
    const supabase = remotos.filter((r) => r.spec.includes("supabase-js"))
    expect(supabase.length).toBeGreaterThan(0)
    expect(supabase.filter((r) => r.spec !== `npm:@supabase/supabase-js@${SUPABASE_JS}`)).toEqual([])
  })
})
