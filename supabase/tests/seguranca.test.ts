// @vitest-environment node
//
// Segurança — etapa 1: o webhook da Evolution compara o segredo em tempo constante e não devolve erro interno,
// e a CSP (Report-Only) do vercel.json acompanha o index.html (hash do script inline) e os domínios usados pelo site.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { createPkcePair, pkceChallenge, pkceCookie, readCookie } from "../functions/_shared/calendar"

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("webhook da Evolution", () => {
  const src = read("supabase/functions/evolution-webhook/index.ts")

  it("compara o segredo com safeEqual (tempo constante)", () => {
    expect(src).toContain("import { safeEqual } from '../_shared/webhook.ts'")
    expect(src).toContain("safeEqual(providedSecret, config.webhookSecret)")
    expect(src).not.toMatch(/!==\s*config\.webhookSecret/)
  })

  it("não devolve mensagem interna de erro na resposta HTTP", () => {
    expect(src).not.toMatch(/JSON\.stringify\(\{\s*error:\s*\w+\.message/)
  })
})

describe("Google Agenda: PKCE e vínculo ao navegador", () => {
  it("calcula o desafio S256 como a RFC 7636 (vetor oficial)", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
  })

  it("gera verificador válido e diferente a cada fluxo", async () => {
    const a = await createPkcePair()
    const b = await createPkcePair()
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.challenge).toBe(await pkceChallenge(a.verifier))
    expect(a.verifier).not.toBe(b.verifier)
  })

  it("lê o cookie HttpOnly e monta o de limpeza", () => {
    expect(readCookie("x=1; gcal_pkce=abc_-1; y=2", "gcal_pkce")).toBe("abc_-1")
    expect(readCookie(null, "gcal_pkce")).toBeNull()
    expect(pkceCookie("", 0, "/p")).toBe("gcal_pkce=; Path=/p; Max-Age=0; HttpOnly; Secure; SameSite=Lax")
  })

  it("a função envia o desafio, só troca o código no POST da conta dona do state (0047) e manda o verificador na troca", () => {
    const src = read("supabase/functions/_shared/calendar-oauth.ts")
    expect(read("supabase/functions/google-calendar-oauth/index.ts")).toContain("handleCalendarOAuth(req,")
    expect(src).toContain('code_challenge_method: "S256"')
    expect(src).toContain('const dono = await deps.rpc("calendar_state_owner", { p_state: state })')
    expect(src).toContain('if (dono.error || dono.data !== user) return json({ error: "forbidden" }, 403)')
    expect(src).toContain("code_verifier: verifier")
    expect(src).not.toContain("Set-Cookie") // o vínculo não depende mais de cookie no navegador que abriu o link
    expect(src).toContain('if (url.searchParams.has("error")) return back("erro")')
  })
})

describe("Edge Functions chamadas pelo painel", () => {
  it.each(["connect-instance", "instance-status", "disconnect-instance"])("%s exige gestão e não devolve erro interno", (nome) => {
    const src = read(`supabase/functions/${nome}/index.ts`)
    expect(src).toContain("requireBarbershopManagement(req,")
    expect(src).not.toMatch(/JSON\.stringify\(\{\s*error:\s*\w+\.message/)
  })
})

describe("CSP em modo Report-Only", () => {
  type Header = { key: string; value: string }
  const vercel = JSON.parse(read("vercel.json")) as { headers: { source: string; headers: Header[] }[] }
  const all = vercel.headers.flatMap((h) => h.headers)
  const csp = all.find((h) => h.key === "Content-Security-Policy-Report-Only")?.value ?? ""
  const directives: Record<string, string[]> = {}
  for (const part of csp.split(";").map((d) => d.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/)
    directives[name] = values
  }

  it("só observa: não existe CSP que bloqueia", () => {
    expect(csp).not.toBe("")
    expect(all.some((h) => h.key === "Content-Security-Policy")).toBe(false)
  })

  it("libera o script inline do index.html pelo hash (mudou o script → atualize o hash)", () => {
    const inline = read("index.html").match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ""
    expect(inline).not.toBe("")
    const hash = `'sha256-${createHash("sha256").update(inline).digest("base64")}'`
    expect(directives["script-src"]).toContain(hash)
    expect(directives["script-src"]).not.toContain("'unsafe-inline'")
    expect(directives["script-src"]).not.toContain("'unsafe-eval'")
  })

  it("cobre os domínios usados pelo site", () => {
    const supabase = "https://hbkbdqctelembzqiptpi.supabase.co"
    expect(directives["connect-src"]).toEqual(expect.arrayContaining(["'self'", supabase, "https://viacep.com.br"]))
    expect(directives["img-src"]).toEqual(expect.arrayContaining(["'self'", "data:", "blob:", supabase, "https://images.unsplash.com"]))
    expect(directives["style-src"]).toContain("https://fonts.googleapis.com")
    expect(directives["font-src"]).toContain("https://fonts.gstatic.com")
    expect(directives["frame-ancestors"]).toEqual(["'none'"])
    expect(directives["object-src"]).toEqual(["'none'"])
  })
})
