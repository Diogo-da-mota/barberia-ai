/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Site personalizável e mídia (F09-01 a F09-04; T15, T03) em PostgreSQL local (PGlite).
// O schema `storage` do Supabase é simulado só o bastante para exercitar as políticas e a validação de mídia.
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
const putObject = (path: string, mime: string, size: number) =>
  db.query("insert into storage.objects (bucket_id, name, metadata) values ('site-media', $1, $2)", [path, { mimetype: mime, size }])

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
  for (const f of ["0001_identidade_inicial", "0002_catalogo", "0003_agenda", "0004_barbeiro", "0007_site"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  lojaA = await val(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")
  lojaB = await val(ID.donoB, "select create_barbershop('Barbearia B', 'barbearia-b')")
  await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'gerente'), ($1, $3, 'barbeiro'), ($1, $4, 'cliente')", [lojaA, ID.gerente, ID.barb, ID.cli])
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("F09-01/02: identidade e personalização limitada", () => {
  it("a gestão grava descrição, cor permitida e endereço; os demais não", async () => {
    await rows(ID.dono, "select save_site_profile($1, 'Cortes clássicos desde 2010', 'ambar', 'Rua A, 10', '11999990000')", [lojaA])
    await rows(ID.gerente, "select save_site_profile($1, 'Cortes clássicos desde 2010', 'azul', 'Rua A, 10', '11999990000')", [lojaA])
    for (const u of [ID.barb, ID.cli, ID.donoB]) await expect(rows(u, "select save_site_profile($1, 'x', 'azul', null, null)", [lojaA])).rejects.toThrow(/forbidden/)
    await rows(ID.donoB, "select save_site_profile($1, 'Navalha e café', 'verde', 'Rua B, 20', null)", [lojaB])
  })

  it("só cores da paleta (contraste garantido) e textos dentro dos limites", async () => {
    await expect(rows(ID.dono, "select save_site_profile($1, 'x', '#ff00ff', null, null)", [lojaA])).rejects.toThrow(/invalid_site/)
    await expect(rows(ID.dono, "select save_site_profile($1, $2, 'azul', null, null)", [lojaA, "x".repeat(501)])).rejects.toThrow(/invalid_site/)
    await expect(rows(ID.dono, "select save_site_profile($1, 'x', 'azul', $2, null)", [lojaA, "x".repeat(201)])).rejects.toThrow(/invalid_site/)
  })

  it("o link público (slug) é validado e único", async () => {
    await expect(rows(ID.dono, "select set_shop_slug($1, 'barbearia-b')", [lojaA])).rejects.toThrow(/slug_taken/)
    await expect(rows(ID.dono, "select set_shop_slug($1, 'Com Espaço')", [lojaA])).rejects.toThrow(/invalid_slug/)
    await expect(rows(ID.dono, "select set_shop_slug($1, 'ab')", [lojaA])).rejects.toThrow(/invalid_slug/)
    await expect(rows(ID.gerente, "select set_shop_slug($1, 'novo-nome')", [lojaA])).rejects.toThrow(/forbidden/) // só o proprietário
    await rows(ID.dono, "select set_shop_slug($1, 'barbearia-alfa')", [lojaA])
    expect(await val(null, "select get_public_shop('barbearia-a') is null")).toBe(true)
    expect(await val(null, "select get_public_shop('barbearia-alfa')->>'nome'")).toBe("Barbearia A")
  })
})

describe("F09-03: upload seguro (T15)", () => {
  it("o bucket é público só para leitura, limitado em tamanho e tipo", async () => {
    const [b] = await rows(null, "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'site-media'")
    expect(b.public).toBe(true)
    expect(Number(b.file_size_limit)).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(b.allowed_mime_types.sort()).toEqual(["image/jpeg", "image/png", "image/webp"])
  })

  it("só a gestão da empresa grava no próprio prefixo; outra empresa, barbeiro, cliente e visitante não", async () => {
    const ok = `${lojaA}/logo.png`
    await as(ID.dono, () => db.query("insert into storage.objects (bucket_id, name, metadata) values ('site-media', $1, '{\"mimetype\":\"image/png\",\"size\":1000}')", [ok]))
    await as(ID.gerente, () => db.query("insert into storage.objects (bucket_id, name, metadata) values ('site-media', $1, '{}')", [`${lojaA}/g1.png`]))
    for (const [u, path] of [[ID.donoB, `${lojaA}/hack.png`], [ID.barb, `${lojaA}/b.png`], [ID.cli, `${lojaA}/c.png`], [ID.dono, `${lojaB}/invasao.png`], [ID.dono, "solto.png"], [null, `${lojaA}/anon.png`]] as const) {
      await expect(as(u, () => db.query("insert into storage.objects (bucket_id, name, metadata) values ('site-media', $1, '{}')", [path]))).rejects.toThrow(/row-level security|permission denied/)
    }
    await expect(as(ID.dono, () => db.query("insert into storage.objects (bucket_id, name, metadata) values ('outro-bucket', $1, '{}')", [`${lojaA}/x.png`]))).rejects.toThrow()
  })

  it("leitura pública dos arquivos do site; apagar só pela gestão da própria empresa", async () => {
    expect((await rows(null, "select name from storage.objects where bucket_id = 'site-media'")).length).toBeGreaterThan(0)
    expect(await as(ID.donoB, async () => (await db.query("delete from storage.objects where name = $1 returning name", [`${lojaA}/g1.png`])).rows)).toHaveLength(0)
    expect(await as(ID.gerente, async () => (await db.query("delete from storage.objects where name = $1 returning name", [`${lojaA}/g1.png`])).rows)).toHaveLength(1)
  })

  it("register_media confere o objeto REAL no storage (tipo, tamanho e dono), não o que o cliente diz", async () => {
    await expect(rows(ID.dono, "select register_media($1, 'logo', $2)", [lojaA, `${lojaA}/nao-existe.png`])).rejects.toThrow(/media_not_found/)
    await putObject(`${lojaA}/grande.png`, "image/png", 5 * 1024 * 1024)
    await expect(rows(ID.dono, "select register_media($1, 'logo', $2)", [lojaA, `${lojaA}/grande.png`])).rejects.toThrow(/invalid_media/)
    await putObject(`${lojaA}/script.svg`, "image/svg+xml", 100)
    await expect(rows(ID.dono, "select register_media($1, 'logo', $2)", [lojaA, `${lojaA}/script.svg`])).rejects.toThrow(/invalid_media/)
    await putObject(`${lojaB}/dela.png`, "image/png", 100)
    await expect(rows(ID.dono, "select register_media($1, 'logo', $2)", [lojaA, `${lojaB}/dela.png`])).rejects.toThrow(/invalid_media/) // caminho de outra empresa
    await expect(rows(ID.dono, "select register_media($1, 'logo', $2)", [lojaA, `${lojaA}/../${lojaB}/dela.png`])).rejects.toThrow(/invalid_media|media_not_found/)
    await expect(rows(ID.barb, "select register_media($1, 'logo', $2)", [lojaA, `${lojaA}/logo.png`])).rejects.toThrow(/forbidden/)
    await expect(rows(ID.dono, "select register_media($1, 'banner', $2)", [lojaA, `${lojaA}/logo.png`])).rejects.toThrow(/invalid_media/)
    await rows(ID.dono, "select register_media($1, 'logo', $2)", [lojaA, `${lojaA}/logo.png`])
  })

  it("logo e capa são únicos (substituem); galeria tem no máximo 8 imagens; remover exige gestão", async () => {
    await putObject(`${lojaA}/logo2.webp`, "image/webp", 2000)
    await rows(ID.dono, "select register_media($1, 'logo', $2)", [lojaA, `${lojaA}/logo2.webp`])
    expect(await rows(ID.dono, "select 1 from media_objects where barbershop_id = $1 and kind = 'logo'", [lojaA])).toHaveLength(1)
    for (let i = 0; i < 8; i++) {
      await putObject(`${lojaA}/g${i + 10}.jpg`, "image/jpeg", 3000)
      await rows(ID.dono, "select register_media($1, 'galeria', $2)", [lojaA, `${lojaA}/g${i + 10}.jpg`])
    }
    await putObject(`${lojaA}/g99.jpg`, "image/jpeg", 3000)
    await expect(rows(ID.dono, "select register_media($1, 'galeria', $2)", [lojaA, `${lojaA}/g99.jpg`])).rejects.toThrow(/media_limit/)
    const [g] = await rows(ID.dono, "select id from media_objects where kind = 'galeria' limit 1")
    await expect(rows(ID.donoB, "select delete_media($1)", [g.id])).rejects.toThrow(/forbidden/)
    await expect(rows(ID.barb, "select delete_media($1)", [g.id])).rejects.toThrow(/forbidden/)
    const path = await val(ID.dono, "select delete_media($1)", [g.id])
    expect(path).toMatch(new RegExp(`^${lojaA}/`))
  })

  it("media_objects só é lida pela equipe; escrita só por função", async () => {
    expect((await rows(ID.dono, "select 1 from media_objects")).length).toBeGreaterThan(0)
    expect(await rows(ID.cli, "select 1 from media_objects")).toHaveLength(0)
    await expect(rows(ID.dono, "insert into media_objects (barbershop_id, kind, storage_path, mime, tamanho_bytes) values ($1, 'logo', 'x', 'image/png', 1)", [lojaA])).rejects.toThrow(/permission denied/)
  })
})

describe("F09-04: página pública sem vazamento (T03)", () => {
  it("duas empresas exibem marcas e dados diferentes", async () => {
    const a = await val(null, "select get_public_shop('barbearia-alfa')")
    const b = await val(null, "select get_public_shop('barbearia-b')")
    expect(a).toMatchObject({ nome: "Barbearia A", descricao: "Cortes clássicos desde 2010", cor_destaque: "azul" })
    expect(b).toMatchObject({ nome: "Barbearia B", descricao: "Navalha e café", cor_destaque: "verde" })
    expect(a.logo_path).toMatch(new RegExp(`^${lojaA}/`))
    expect(b.logo_path).toBeNull()
    expect(a.galeria.length).toBe(7)
    expect(a.galeria.every((p: string) => p.startsWith(`${lojaA}/`))).toBe(true)
  })

  it("a resposta pública não contém dono, clientes, financeiro nem identificadores internos de pessoas", async () => {
    const a = await val(null, "select get_public_shop('barbearia-alfa')")
    const texto = JSON.stringify(a)
    for (const proibido of ["owner_id", "customer", "cliente_", "email", "comiss", "pagamento", ID.dono, ID.cli, "profile_id"]) expect(texto).not.toContain(proibido)
  })

  it("barbearia inativa não aparece", async () => {
    await db.query("update barbershops set status = 'inativo' where id = $1", [lojaB])
    expect(await val(null, "select get_public_shop('barbearia-b') is null")).toBe(true)
  })
})
