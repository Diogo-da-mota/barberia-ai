import { beforeEach, describe, expect, it, vi } from "vitest"

const query = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  supabase: { from: query.from },
}))

import { fetchMyBarbershops } from "./api"

function respondWith(response: { data: unknown; error: unknown }) {
  query.eq.mockResolvedValue(response)
}

beforeEach(() => {
  vi.clearAllMocks()
  query.from.mockReturnValue({ select: query.select })
  query.select.mockReturnValue({ eq: query.eq })
})

describe("fetchMyBarbershops", () => {
  it("filtra os vínculos pelo usuário da sessão e converte as linhas", async () => {
    respondWith({
      data: [
        {
          papel: "gerente",
          barbershops: {
            id: "b1",
            nome: "Barbearia A",
            slug: "barbearia-a",
            endereco: "Rua Um",
            status: "ativo",
          },
        },
      ],
      error: null,
    })

    await expect(fetchMyBarbershops("user-1")).resolves.toEqual({
      status: "ok",
      barbershops: [
        {
          id: "b1",
          nome: "Barbearia A",
          slug: "barbearia-a",
          endereco: "Rua Um",
          status: "ativo",
          papel: "gerente",
        },
      ],
    })
    expect(query.from).toHaveBeenCalledWith("memberships")
    expect(query.eq).toHaveBeenCalledWith("profile_id", "user-1")
  })

  it("ignora vínculo cuja barbearia não foi retornada", async () => {
    respondWith({ data: [{ papel: "cliente", barbershops: null }], error: null })

    await expect(fetchMyBarbershops("user-1")).resolves.toEqual({
      status: "ok",
      barbershops: [],
    })
  })

  it("informa indisponibilidade quando a tabela ainda não existe", async () => {
    respondWith({ data: null, error: { code: "PGRST205", message: "tabela ausente" } })

    await expect(fetchMyBarbershops("user-1")).resolves.toEqual({ status: "unavailable" })
  })

  it("lança erro nas demais falhas", async () => {
    respondWith({ data: null, error: { code: "42P17", message: "detalhe interno" } })

    await expect(fetchMyBarbershops("user-1")).rejects.toMatchObject({ code: "42P17" })
  })
})
