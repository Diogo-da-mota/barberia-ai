/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Migration 0014: palavras reservadas como endereço (slug) de barbearia, em PostgreSQL local (PGlite).
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite({ extensions: { btree_gist } })
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), donoB: U("b1"), gerente: U("a2"), barb: U("c1"), cli: U("d1") }
let lojaA = "", lojaB = ""

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
const val = async (user: string | null, sql: string, params: unknown[] = []) => Object.values((await rows(user, sql, params))[0])[0] as any
const fails = async (user: string | null, sql: string, params: unknown[] = []) => {
  try { await rows(user, sql, params); return null } catch (e) { return String((e as Error).message) }
}

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb);
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
    grant select on storage.buckets to anon, authenticated;
    alter table storage.objects enable row level security;
  `)
  for (const f of ["0001_identidade_inicial", "0002_catalogo", "0003_agenda", "0004_barbeiro", "0007_site", "0010_servico_imagem", "0011_site_template", "0014_slugs_reservados"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  lojaA = await val(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")
  lojaB = await val(ID.donoB, "select create_barbershop('Barbearia B', 'barbearia-b')")
  await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'gerente'), ($1, $3, 'barbeiro'), ($1, $4, 'cliente')", [lojaA, ID.gerente, ID.barb, ID.cli])
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("slugs reservados (0014)", () => {
  it("o endereço livre continua funcionando, inclusive parecido com palavra reservada", async () => {
    expect(lojaA).toBeTruthy()
    expect(await val(ID.donoB, "select slug from barbershops where id = $1", [lojaB])).toBe("barbearia-b")
    const id = await val(ID.dono, "select create_barbershop('Dashboard Barber', 'dashboard-barber')")
    expect(await val(ID.dono, "select slug from barbershops where id = $1", [id])).toBe("dashboard-barber")
  })

  it("não cria barbearia com palavra reservada, em qualquer caixa", async () => {
    for (const slug of ["dashboard", "login", "auth", "acesso", "convite", "minhas-reservas", "e", "site", "api", "Dashboard"]) {
      const e = await fails(ID.dono, "select create_barbershop('Teste', $1)", [slug])
      expect(e, slug).toBeTruthy()
    }
  })

  it("o proprietário não troca o endereço para uma palavra reservada; o endereço atual fica como estava", async () => {
    for (const slug of ["login", "dashboard", "site-albuns"]) expect(await fails(ID.dono, "select set_shop_slug($1, $2)", [lojaA, slug]), slug).toBeTruthy()
    expect(await val(ID.dono, "select slug from barbershops where id = $1", [lojaA])).toBe("barbearia-a")
    await rows(ID.dono, "select set_shop_slug($1, 'barbearia-a-nova')", [lojaA])
    expect(await val(ID.dono, "select slug from barbershops where id = $1", [lojaA])).toBe("barbearia-a-nova")
  })

  it("a função de conferência ignora espaços e caixa", async () => {
    expect(await val(ID.dono, "select private.is_reserved_slug(' Login ')")).toBe(true)
    expect(await val(ID.dono, "select private.is_reserved_slug('barbearia')")).toBe(false)
    expect(await val(ID.dono, "select private.is_reserved_slug(null)")).toBe(false)
  })
})
