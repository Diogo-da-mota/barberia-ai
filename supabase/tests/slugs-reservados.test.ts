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

describe("endereço já usado fica com a barbearia de origem (0040)", () => {
  const dono = async (slug: string) => (await db.query<{ barbershop_id: string }>("select barbershop_id from barbershop_slugs where slug = $1", [slug])).rows[0]?.barbershop_id ?? null
  const atual = async (loja: string) => (await db.query<{ slug: string }>("select slug from barbershops where id = $1", [loja])).rows[0].slug

  beforeAll(async () => {
    // Antes da 0040 a Barbearia A já trocou 'barbearia-a' por 'barbearia-a-nova' (teste acima): o antigo vem do registro de criação.
    expect(await atual(lojaA)).toBe("barbearia-a-nova")
    await db.exec(readFileSync("supabase/migrations/0040_slug_registro.sql", "utf8"))
  })

  it("carga inicial: endereços atuais e o endereço de criação ficam com a própria barbearia", async () => {
    expect([await dono("barbearia-a-nova"), await dono("barbearia-a"), await dono("barbearia-b")]).toEqual([lojaA, lojaA, lojaB])
  })

  it("outra barbearia não assume endereço antigo (create_barbershop nem set_shop_slug); a página antiga continua vazia", async () => {
    expect(await fails(ID.donoB, "select set_shop_slug($1, 'barbearia-a')", [lojaB])).toMatch(/slug_taken/)
    expect(await fails(ID.donoB, "select create_barbershop('Barbearia do Tico', 'barbearia-a')")).toMatch(/slug_taken/)
    expect((await rows(null, "select get_public_shop('barbearia-a') as s"))[0]?.s ?? null).toBeNull()
    expect(await atual(lojaB)).toBe("barbearia-b")
  })

  it("a barbearia de origem volta ao endereço antigo; o que ela deixou também fica com ela", async () => {
    await rows(ID.dono, "select set_shop_slug($1, 'barbearia-a')", [lojaA])
    expect(await atual(lojaA)).toBe("barbearia-a")
    expect(await fails(ID.donoB, "select set_shop_slug($1, 'barbearia-a-nova')", [lojaB])).toMatch(/slug_taken/)
    expect(await fails(ID.donoB, "select create_barbershop('Outra', 'barbearia-a-nova')")).toMatch(/slug_taken/)
  })

  it("endereço novo continua livre, a troca registra o anterior e palavra reservada segue recusada", async () => {
    await rows(ID.donoB, "select set_shop_slug($1, 'barbearia-b-dois')", [lojaB])
    expect(await dono("barbearia-b-dois")).toBe(lojaB)
    expect(await fails(ID.dono, "select create_barbershop('Mais uma', 'barbearia-b')")).toMatch(/slug_taken/)
    const nova = await val(ID.dono, "select create_barbershop('Barbearia Nova', 'barbearia-nova-livre')")
    expect(await dono("barbearia-nova-livre")).toBe(nova)
    expect(await fails(ID.donoB, "select set_shop_slug($1, 'login')", [lojaB])).toBeTruthy()
  })

  it("o registro e a função do gatilho não são acessíveis pela API", async () => {
    for (const u of [ID.dono, null]) expect(await fails(u, "select * from barbershop_slugs")).toMatch(/permission denied/)
    expect(await fails(ID.dono, "select private.claim_shop_slug()")).toMatch(/permission denied|trigger/)
  })
})

describe("limite de endereços por barbearia (0053)", () => {
  const slug = async (id: string) => val(ID.donoB, "select slug from barbershops where id = $1", [id])
  const registro = async (s: string) => (await db.query<{ barbershop_id: string }>("select barbershop_id from barbershop_slugs where slug = $1", [s])).rows[0]?.barbershop_id ?? null
  beforeAll(async () => {
    await db.exec(readFileSync("supabase/migrations/0053_slug_limite.sql", "utf8"))
  })

  it("a barbearia usa até 5 endereços; o 6º novo é recusado com slug_limit e o endereço atual não muda", async () => {
    const loja = await val(ID.donoB, "select create_barbershop('Barbearia Limite', 'limite-1')")
    for (const n of [2, 3, 4, 5]) await rows(ID.donoB, "select set_shop_slug($1, $2)", [loja, `limite-${n}`])
    expect(await fails(ID.donoB, "select set_shop_slug($1, 'limite-6')", [loja])).toMatch(/slug_limit/)
    expect(await slug(loja)).toBe("limite-5")
    expect(await registro("limite-6")).toBeNull()
  })

  it("voltar a um endereço já usado continua livre; o recusado segue disponível para outra barbearia; endereço de outra continua slug_taken", async () => {
    const loja = await val(ID.donoB, "select id from barbershops where slug = 'limite-5'")
    await rows(ID.donoB, "select set_shop_slug($1, 'limite-2')", [loja])
    expect(await slug(loja)).toBe("limite-2")
    const outra = await val(ID.gerente, "select create_barbershop('Outra Barbearia', 'limite-6')")
    expect(await registro("limite-6")).toBe(outra)
    expect(await fails(ID.donoB, "select set_shop_slug($1, 'barbearia-a')", [loja])).toMatch(/slug_taken/)
  })
})
