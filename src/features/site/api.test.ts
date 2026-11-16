/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest"

const sb = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), remove: vi.fn(), from: vi.fn() }))
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: sb.invoke },
    rpc: sb.rpc,
    from: sb.from,
    storage: { from: () => ({ remove: sb.remove, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://supa.test/${path}` } }) }) },
  },
}))

import { fetchPanelPhotos, publicMediaUrl, removeMedia, uploadMedia } from "./api"

const file = new File(["x"], "foto.jpg", { type: "image/jpeg" })
const NOVA = "BARBEARIA/loja-1/painel/sidebar/nova.jpg"
const VELHA = "BARBEARIA/loja-1/painel/sidebar/velha.jpg"
/** Consulta encadeada do supabase-js que termina em `in` ou `maybeSingle`. */
const query = (result: unknown) => { const q: any = { select: () => q, eq: () => q, in: async () => result, maybeSingle: async () => result }; return q }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("VITE_MEDIA_CDN_URL", "https://cdn.test/")
})

describe("endereço das fotos", () => {
  it("foto no S3 pelo CloudFront; caminho antigo pelo Supabase até a cópia", () => {
    expect(publicMediaUrl("BARBEARIA/loja-1/site/logo/a.jpg")).toBe("https://cdn.test/BARBEARIA/loja-1/site/logo/a.jpg")
    expect(publicMediaUrl("loja-1/logo-x.png")).toBe("https://supa.test/loja-1/logo-x.png")
    expect(publicMediaUrl(null)).toBeNull()
  })
})

describe("trocar e remover fotos (uma por posição, sem guardar a antiga)", () => {
  it("envia para a pasta do tipo no S3, registra e apaga só a foto substituída", async () => {
    sb.invoke.mockResolvedValueOnce({ data: { key: NOVA, size: 1234 }, error: null }).mockResolvedValueOnce({ data: { ok: true }, error: null })
    sb.rpc.mockResolvedValue({ data: VELHA, error: null })
    await uploadMedia("loja-1", "painel_sidebar", file)
    const form = sb.invoke.mock.calls[0][1].body as FormData
    expect([sb.invoke.mock.calls[0][0], form.get("barbearia"), form.get("pasta"), form.get("arquivo")]).toEqual(["media", "loja-1", "painel/sidebar", expect.any(File)])
    expect(sb.rpc).toHaveBeenCalledWith("register_media", { p_barbershop_id: "loja-1", p_kind: "painel_sidebar", p_path: NOVA, p_size: 1234 })
    expect(sb.invoke).toHaveBeenLastCalledWith("media", { body: { apagar: [VELHA] } })
  })

  it("se o banco recusar, apaga o envio e não mexe na foto atual", async () => {
    sb.invoke.mockResolvedValue({ data: { key: NOVA, size: 10 }, error: null })
    sb.rpc.mockResolvedValue({ data: null, error: { message: "media_limit" } })
    await expect(uploadMedia("loja-1", "galeria", file)).rejects.toMatchObject({ message: "media_limit" })
    expect(sb.invoke).toHaveBeenCalledTimes(2)
    expect(sb.invoke).toHaveBeenLastCalledWith("media", { body: { apagar: [NOVA] } })
  })

  it("erro da função vira o código que a tela traduz, e nada é registrado", async () => {
    sb.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }) } })
    await expect(uploadMedia("loja-1", "logo", file)).rejects.toThrow("forbidden")
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it("foto antiga que ainda está no Supabase é apagada de lá quando substituída ou removida", async () => {
    sb.invoke.mockResolvedValue({ data: { key: "BARBEARIA/loja-1/site/logo/n.png", size: 10 }, error: null })
    sb.rpc.mockResolvedValue({ data: "loja-1/logo-x.png", error: null })
    await uploadMedia("loja-1", "logo", file)
    expect(sb.remove).toHaveBeenCalledWith(["loja-1/logo-x.png"])
    expect(sb.invoke).toHaveBeenCalledTimes(1) // só o envio: nada a apagar no S3
    sb.rpc.mockResolvedValue({ data: VELHA, error: null })
    await removeMedia("id-1")
    expect(sb.rpc).toHaveBeenLastCalledWith("delete_media", { p_id: "id-1" })
    expect(sb.invoke).toHaveBeenLastCalledWith("media", { body: { apagar: [VELHA] } })
  })
})

describe("fotos do painel e do login", () => {
  it("lê os registros da barbearia; sem foto própria, a padrão (null)", async () => {
    sb.from.mockReturnValue(query({ data: [{ kind: "painel_inicio", storage_path: "BARBEARIA/loja-1/painel/inicio/a.jpg" }], error: null }))
    await expect(fetchPanelPhotos("loja-1")).resolves.toEqual({
      menu: null, inicio: "https://cdn.test/BARBEARIA/loja-1/painel/inicio/a.jpg", agenda: null, servicos: null, financeiro: null, login: null,
    })
    expect(sb.from).toHaveBeenCalledWith("media_objects")
  })

  it("erro na leitura não vira 'foto padrão' em silêncio", async () => {
    sb.from.mockReturnValue(query({ data: null, error: new Error("falhou") }))
    await expect(fetchPanelPhotos("loja-1")).rejects.toThrow("falhou")
  })
})
