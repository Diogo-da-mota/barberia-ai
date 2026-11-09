// @vitest-environment node
//
// Testes de RLS do catálogo e da equipe (F03-01, F03-02, F03-05), em PostgreSQL local (PGlite).
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite()

const ID = {
  dono: "00000000-0000-4000-8000-00000000000a",
  donoB: "00000000-0000-4000-8000-00000000000b",
  gerente: "00000000-0000-4000-8000-00000000000c",
  barbeiro: "00000000-0000-4000-8000-00000000000d",
  cliente: "00000000-0000-4000-8000-00000000000e",
}
let lojaA = ""
let lojaB = ""
let corteA = ""
let barbaA = ""
let corteB = ""

async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""])
  await db.exec(`set role ${user ? "authenticated" : "anon"}`)
  try {
    return await fn()
  } finally {
    await db.exec("reset role")
  }
}
const rows = (user: string | null, sql: string, params: unknown[] = []) =>
  as(user, async () => (await db.query<Record<string, unknown>>(sql, params)).rows)
const scalar = async (user: string | null, sql: string, params: unknown[] = []) => Object.values((await rows(user, sql, params))[0])[0]

const novoServico = (user: string, loja: string, nome: string, preco = 6000, duracao = 40) =>
  rows(user, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, $2, $3, $4) returning id", [loja, nome, preco, duracao])

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `)
  for (const file of ["0001_identidade_inicial", "0002_catalogo"]) {
    await db.exec(readFileSync(`supabase/migrations/${file}.sql`, "utf8"))
  }
  for (const [nome, id] of Object.entries(ID)) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${nome}@example.test`])
  }
  lojaA = (await scalar(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")) as string
  lojaB = (await scalar(ID.donoB, "select create_barbershop('Barbearia B', 'barbearia-b')")) as string
  for (const [profile, papel] of [[ID.gerente, "gerente"], [ID.barbeiro, "barbeiro"], [ID.cliente, "cliente"]]) {
    await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, $3)", [lojaA, profile, papel])
  }
  corteA = (await novoServico(ID.dono, lojaA, "Corte"))[0].id as string
  barbaA = (await novoServico(ID.gerente, lojaA, "Barba", 4000, 20))[0].id as string
  corteB = (await novoServico(ID.donoB, lojaB, "Corte B"))[0].id as string
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("F03-01: serviços", () => {
  it("proprietário e gerente criam e alteram serviços", async () => {
    await rows(ID.gerente, "update services set preco_centavos = 6500 where id = $1", [corteA])
    expect(await scalar(ID.dono, "select preco_centavos from services where id = $1", [corteA])).toBe(6500)
    await rows(ID.dono, "update services set preco_centavos = 6000 where id = $1", [corteA])
  })

  it("barbeiro e cliente leem o catálogo da barbearia, mas não escrevem", async () => {
    for (const user of [ID.barbeiro, ID.cliente]) {
      expect((await rows(user, "select id from services")).map((r) => r.id).sort()).toEqual([corteA, barbaA].sort())
      await expect(novoServico(user, lojaA, "Invasor")).rejects.toThrow(/row-level security/)
      expect(await rows(user, "update services set preco_centavos = 1 where id = $1 returning id", [corteA])).toHaveLength(0)
      expect(await rows(user, "delete from services where id = $1 returning id", [corteA])).toHaveLength(0)
    }
  })

  it("T03: outra empresa não lê nem escreve no catálogo", async () => {
    expect(await rows(ID.donoB, "select id from services")).toEqual([{ id: corteB }])
    await expect(novoServico(ID.donoB, lojaA, "Invasor")).rejects.toThrow(/row-level security/)
    expect(await rows(ID.donoB, "update services set nome = 'X' where id = $1 returning id", [corteA])).toHaveLength(0)
    expect(await rows(ID.donoB, "delete from services where id = $1 returning id", [corteA])).toHaveLength(0)
  })

  it("não move um serviço para outra barbearia", async () => {
    await expect(rows(ID.dono, "update services set barbershop_id = $1 where id = $2", [lojaB, corteA])).rejects.toThrow(/permission denied/)
  })

  it("valida preço em centavos, duração e nome", async () => {
    await expect(novoServico(ID.dono, lojaA, "Negativo", -1)).rejects.toThrow(/check/)
    await expect(novoServico(ID.dono, lojaA, "Sem duração", 1000, 0)).rejects.toThrow(/check/)
    await expect(novoServico(ID.dono, lojaA, "Longo", 1000, 481)).rejects.toThrow(/check/)
    await expect(novoServico(ID.dono, lojaA, "   ")).rejects.toThrow(/check/)
    await expect(rows(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Decimal', 10.5, 30)", [lojaA])).resolves.toBeDefined()
  })

  it("não repete o nome na mesma barbearia, mas outra barbearia pode usá-lo", async () => {
    await expect(novoServico(ID.dono, lojaA, "Corte")).rejects.toThrow(/unique|duplicate/i)
    expect(await novoServico(ID.donoB, lojaB, "Corte")).toHaveLength(1)
  })

  it("anônimo não acessa o catálogo", async () => {
    await expect(rows(null, "select 1 from services")).rejects.toThrow(/permission denied/)
  })
})

describe("F03-02: equipe", () => {
  let joao = ""
  const salvar = (user: string, loja: string, id: string | null, nome: string, ativo: boolean, servicos: string[]) =>
    scalar(user, "select save_professional($1, $2, $3, $4, $5)", [loja, id, nome, ativo, servicos]) as Promise<string>

  it("o gestor cria o profissional com os serviços em uma única operação", async () => {
    joao = await salvar(ID.gerente, lojaA, null, "João", true, [corteA, barbaA])
    const links = await rows(ID.barbeiro, "select service_id from professional_services where professional_id = $1", [joao])
    expect(links.map((r) => r.service_id).sort()).toEqual([corteA, barbaA].sort())
  })

  it("atualizar troca os serviços e o nome", async () => {
    await salvar(ID.dono, lojaA, joao, "João Silva", false, [barbaA])
    expect(await rows(ID.dono, "select nome, ativo from professionals where id = $1", [joao])).toEqual([{ nome: "João Silva", ativo: false }])
    expect(await rows(ID.dono, "select service_id from professional_services where professional_id = $1", [joao])).toEqual([{ service_id: barbaA }])
  })

  it("barbeiro e cliente leem a equipe, mas não alteram", async () => {
    for (const user of [ID.barbeiro, ID.cliente]) {
      expect(await rows(user, "select id from professionals")).toEqual([{ id: joao }])
      await expect(salvar(user, lojaA, joao, "Troca", true, [])).rejects.toThrow(/forbidden/)
      await expect(salvar(user, lojaA, null, "Novo", true, [])).rejects.toThrow(/forbidden/)
      await expect(rows(user, "insert into professionals (barbershop_id, nome) values ($1, 'Direto')", [lojaA])).rejects.toThrow(/permission denied/)
      expect(await rows(user, "delete from professionals where id = $1 returning id", [joao])).toHaveLength(0)
    }
  })

  it("T03: outra empresa não lê nem altera a equipe", async () => {
    expect(await rows(ID.donoB, "select id from professionals")).toHaveLength(0)
    await expect(salvar(ID.donoB, lojaA, joao, "Invasor", true, [])).rejects.toThrow(/forbidden/)
    await expect(salvar(ID.donoB, lojaA, null, "Invasor", true, [])).rejects.toThrow(/forbidden/)
  })

  it("não liga o profissional a um serviço de outra barbearia", async () => {
    await expect(salvar(ID.dono, lojaA, joao, "João Silva", true, [corteB])).rejects.toThrow(/invalid_service/)
    await expect(
      db.query("insert into professional_services (barbershop_id, professional_id, service_id) values ($1, $2, $3)", [lojaA, joao, corteB])
    ).rejects.toThrow(/foreign key/)
  })

  it("profissional de outra barbearia não pode ser editado por id", async () => {
    const pb = await salvar(ID.donoB, lojaB, null, "Pedro", true, [corteB])
    await expect(salvar(ID.dono, lojaA, pb, "Roubado", true, [])).rejects.toThrow(/not_found/)
    expect(await scalar(ID.donoB, "select nome from professionals where id = $1", [pb])).toBe("Pedro")
  })

  it("não repete o nome e o gestor remove o profissional", async () => {
    await expect(salvar(ID.dono, lojaA, null, "João Silva", true, [])).rejects.toThrow(/unique|duplicate/i)
    expect(await rows(ID.dono, "delete from professionals where id = $1 returning id", [joao])).toHaveLength(1)
    expect(await rows(ID.dono, "select 1 from professional_services where professional_id = $1", [joao])).toHaveLength(0)
  })

  it("excluir um serviço remove só a ligação com a equipe", async () => {
    const ana = await salvar(ID.dono, lojaA, null, "Ana", true, [corteA, barbaA])
    await rows(ID.dono, "delete from services where id = $1", [barbaA])
    expect(await rows(ID.dono, "select service_id from professional_services where professional_id = $1", [ana])).toEqual([{ service_id: corteA }])
  })
})
