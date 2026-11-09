import { describe, it, expect } from "vitest"

describe("variáveis de ambiente públicas", () => {
  it("expõe URL e chave anônima do Supabase no cliente", () => {
    expect(import.meta.env.VITE_SUPABASE_URL).toBeDefined()
    expect(import.meta.env.VITE_SUPABASE_URL.length).toBeGreaterThan(0)
    expect(import.meta.env.VITE_SUPABASE_ANON_KEY).toBeDefined()
    expect(import.meta.env.VITE_SUPABASE_ANON_KEY.length).toBeGreaterThan(0)
  })
})
