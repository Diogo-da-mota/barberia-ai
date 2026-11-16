/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Instruções da Lara por barbearia (migration 0025): só a gestão grava, cada barbearia vê só as suas, visitante não lê.
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite()
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), donoB: U("b1"), gerente: U("c1"), barb: U("d1") }
let loja = "", lojaB = ""

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
const rows = (user: string | null, sql: string, params: unknown[] = []) => as(user, async () => (await db.query<Record<string, any>>(sql, params)).rows)
const salvar = (user: string, shop: string, texto: string) => rows(user, "select save_assistant_instructions($1, $2)", [shop, texto])
const ler = async (user: string | null, shop: string) => (await rows(user, "select assistente_instrucoes from barbershops where id = $1", [shop]))[0]?.assistente_instrucoes

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `)
  for (const f of ["0001_identidade_inicial", "0025_instrucoes_assistente"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  for (const [nome, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${nome}@example.test`, { full_name: nome }])
  loja = (await rows(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a') as id"))[0].id
  lojaB = (await rows(ID.donoB, "select create_barbershop('Barbearia B', 'barbearia-b') as id"))[0].id
  await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'gerente'), ($1, $3, 'barbeiro')", [loja, ID.gerente, ID.barb])
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("instruções da Lara (0025)", () => {
  it("começa vazio; proprietário e gerente gravam (sem espaços nas pontas)", async () => {
    expect(await ler(ID.dono, loja)).toBe("")
    await salvar(ID.dono, loja, "  Chame os clientes pelo primeiro nome.  ")
    expect(await ler(ID.dono, loja)).toBe("Chame os clientes pelo primeiro nome.")
    await salvar(ID.gerente, loja, "Responda sempre com o total do dia.")
    expect(await ler(ID.gerente, loja)).toBe("Responda sempre com o total do dia.")
  })

  it("barbeiro e dono de outra barbearia não gravam; texto acima de 2000 caracteres é recusado", async () => {
    await expect(salvar(ID.barb, loja, "x")).rejects.toThrow(/forbidden/)
    await expect(salvar(ID.donoB, loja, "x")).rejects.toThrow(/forbidden/)
    await expect(salvar(ID.dono, loja, "a".repeat(2001))).rejects.toThrow(/invalid_instructions/)
    await expect(rows(ID.dono, "update barbershops set assistente_instrucoes = 'direto' where id = $1", [loja])).rejects.toThrow(/permission denied/)
  })

  it("cada barbearia lê só as suas; visitante não lê", async () => {
    expect(await ler(ID.donoB, loja)).toBeUndefined() // RLS: não é membro
    expect(await ler(ID.donoB, lojaB)).toBe("")
    await expect(ler(null, loja)).rejects.toThrow(/permission denied/)
  })
})
