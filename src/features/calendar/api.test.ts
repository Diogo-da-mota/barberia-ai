// Vínculo do Google Agenda no app (P1, migration 0047): o verificador PKCE fica só no navegador de quem iniciou e o vínculo é
// concluído pela função com a sessão do painel. Um retorno sem o verificador deste navegador (link iniciado por outra pessoa)
// nunca chama a função.
import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

const sb = vi.hoisted(() => ({ rpc: vi.fn(), functions: { invoke: vi.fn() } }))
vi.mock("@/lib/supabase", () => ({ supabase: sb }))

import { finishLink, readCalendarReturn, startLink } from "./api"

describe("vínculo do Google Agenda no app", () => {
  beforeEach(() => {
    sessionStorage.clear()
    sb.rpc.mockReset()
    sb.functions.invoke.mockReset()
    vi.stubEnv("VITE_SUPABASE_URL", "https://projeto.example.test")
  })

  it("startLink guarda o verificador só neste navegador e manda à função o desafio S256 dele", async () => {
    sb.rpc.mockResolvedValue({ data: "estado-1", error: null })
    const url = new URL(await startLink("prof-1"))
    expect(sb.rpc).toHaveBeenCalledWith("start_calendar_link", { p_professional_id: "prof-1" })
    expect(`${url.origin}${url.pathname}`).toBe("https://projeto.example.test/functions/v1/google-calendar-oauth")
    expect(url.searchParams.get("state")).toBe("estado-1")
    const verifier = sessionStorage.getItem("barberia:gcal-pkce:estado-1")!
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"))
    expect(url.toString()).not.toContain(verifier)
  })

  it("lê o retorno do Google só do fragmento", () => {
    expect(readCalendarReturn("#gcal_code=c%2F1&gcal_state=e1")).toEqual({ code: "c/1", state: "e1" })
    expect(readCalendarReturn("#gcal_code=c1")).toBeNull()
    expect(readCalendarReturn("")).toBeNull()
  })

  it("sem o verificador deste navegador (link de outra pessoa), não conclui e não chama a função", async () => {
    await expect(finishLink("codigo-da-vitima", "estado-do-atacante")).rejects.toThrow("outro_navegador")
    expect(sb.functions.invoke).not.toHaveBeenCalled()
  })

  it("com o verificador, conclui pela função (com a sessão do painel) e o verificador vale uma vez só", async () => {
    sessionStorage.setItem("barberia:gcal-pkce:e2", "v".repeat(43))
    sb.functions.invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await finishLink("c2", "e2")
    expect(sb.functions.invoke).toHaveBeenCalledWith("google-calendar-oauth", { body: { code: "c2", state: "e2", code_verifier: "v".repeat(43) } })
    expect(sessionStorage.getItem("barberia:gcal-pkce:e2")).toBeNull()
    await expect(finishLink("c2", "e2")).rejects.toThrow("outro_navegador")
  })

  it("erro da função (ex.: conta que não é dona do state) é repassado", async () => {
    sessionStorage.setItem("barberia:gcal-pkce:e3", "v".repeat(43))
    sb.functions.invoke.mockResolvedValue({ data: null, error: new Error("forbidden") })
    await expect(finishLink("c3", "e3")).rejects.toThrow("forbidden")
  })
})
