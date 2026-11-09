/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Imagem dos serviços (migration 0010): quem grava, validação do arquivo real no storage e exposição pública.
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite({ extensions: { btree_gist } })
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), donoB: U("b1"), barb: U("c1"), cli: U("d1") }
let loja = "", lojaB = "", corte = "", outro = ""

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
  for (const f of ["0001_identidade_inicial", "0002_catalogo", "0003_agenda", "0004_barbeiro", "0007_site", "0010_servico_imagem"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  loja = await val(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")
  lojaB = await val(ID.donoB, "select create_barbershop('Barbearia B', 'barbearia-b')")
  await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'barbeiro')", [loja, ID.barb])
  corte = (await rows(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [loja]))[0].id
  outro = (await rows(ID.donoB, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Barba', 4500, 30) returning id", [lojaB]))[0].id
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("gravação da imagem do serviço", () => {
  const nome = () => `${loja}/servico-${corte}-abc123.png`

  it("a gestão vincula a imagem já enviada e recebe o caminho antigo ao trocar", async () => {
    await putObject(nome(), "image/png", 1000)
    expect(await val(ID.dono, "select set_service_image($1, $2)", [corte, nome()])).toBeNull()
    expect(await val(ID.dono, "select imagem_path from services where id = $1", [corte])).toBe(nome())
    await putObject(`${loja}/servico-${corte}-nova01.webp`, "image/webp", 500)
    expect(await val(ID.dono, "select set_service_image($1, $2)", [corte, `${loja}/servico-${corte}-nova01.webp`])).toBe(nome())
  })

  it("barbeiro, cliente e outra empresa não gravam a imagem", async () => {
    await putObject(`${loja}/servico-${corte}-hack01.png`, "image/png", 100)
    for (const u of [ID.barb, ID.cli, ID.donoB]) await expect(rows(u, "select set_service_image($1, $2)", [corte, `${loja}/servico-${corte}-hack01.png`])).rejects.toThrow(/forbidden/)
  })

  it("recusa caminho que não é do serviço, de outra empresa, arquivo inexistente, SVG e arquivo grande", async () => {
    await putObject(`${loja}/servico-${corte}-svg001.svg`, "image/svg+xml", 100)
    await putObject(`${loja}/servico-${corte}-big001.png`, "image/png", 5 * 1024 * 1024)
    await putObject(`${lojaB}/servico-${outro}-x1.png`, "image/png", 100)
    await expect(rows(ID.dono, "select set_service_image($1, $2)", [corte, `${loja}/logo-x.png`])).rejects.toThrow(/invalid_media/)
    await expect(rows(ID.dono, "select set_service_image($1, $2)", [corte, `${loja}/servico-${outro}-x1.png`])).rejects.toThrow(/invalid_media/)
    await expect(rows(ID.dono, "select set_service_image($1, $2)", [corte, `${lojaB}/servico-${outro}-x1.png`])).rejects.toThrow(/invalid_media/)
    await expect(rows(ID.dono, "select set_service_image($1, $2)", [corte, `${loja}/servico-${corte}-nao-existe.png`])).rejects.toThrow(/media_not_found/)
    await expect(rows(ID.dono, "select set_service_image($1, $2)", [corte, `${loja}/servico-${corte}-svg001.svg`])).rejects.toThrow(/invalid_media/)
    await expect(rows(ID.dono, "select set_service_image($1, $2)", [corte, `${loja}/servico-${corte}-big001.png`])).rejects.toThrow(/invalid_media/)
  })

  it("remover a imagem devolve o caminho antigo; o cliente não altera a coluna direto", async () => {
    expect(await val(ID.dono, "select set_service_image($1, null)", [corte])).toBe(`${loja}/servico-${corte}-nova01.webp`)
    expect(await val(ID.dono, "select imagem_path from services where id = $1", [corte])).toBeNull()
    await expect(rows(ID.dono, "update services set imagem_path = 'qualquer' where id = $1", [corte])).rejects.toThrow(/permission denied/)
  })
})

describe("exposição pública", () => {
  it("a página pública devolve o caminho da imagem de cada serviço, sem vazar campos internos", async () => {
    await putObject(`${loja}/servico-${corte}-pub001.jpg`, "image/jpeg", 800)
    await val(ID.dono, "select set_service_image($1, $2)", [corte, `${loja}/servico-${corte}-pub001.jpg`])
    const shop = await val(null, "select get_public_shop('barbearia-a')")
    const svc = shop.services.find((s: any) => s.id === corte)
    expect(svc.imagem_path).toBe(`${loja}/servico-${corte}-pub001.jpg`)
    expect(Object.keys(svc).sort()).toEqual(["descricao", "duracao_min", "fotos", "id", "imagem_path", "nome", "preco_centavos"])
  })
})
