/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Galeria de até 5 fotos por serviço (migration 0010) e foto de perfil do profissional (migration 0007).
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite({ extensions: { btree_gist } })
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), donoB: U("b1"), barb: U("c1") }
let loja = "", lojaB = "", corte = "", ana = ""

async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""])
  await db.exec(`set role ${user ? "authenticated" : "anon"}`)
  try { return await fn() } finally { await db.exec("reset role") }
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
  ana = await val(ID.dono, "select save_professional($1, null, 'Ana', true, $2)", [loja, [corte]])
}, 60_000)

afterAll(async () => { await db.close() })

describe("galeria do serviço: até 5 fotos", () => {
  const foto = (n: number) => `${loja}/servico-${corte}-f${n}.jpg`
  it("adiciona fotos em ordem e recusa a 6ª", async () => {
    for (let n = 1; n <= 5; n++) {
      await putObject(foto(n), "image/jpeg", 1000)
      await val(ID.dono, "select add_service_photo($1, $2)", [corte, foto(n)])
    }
    await putObject(foto(6), "image/jpeg", 1000)
    await expect(rows(ID.dono, "select add_service_photo($1, $2)", [corte, foto(6)])).rejects.toThrow(/photo_limit/)
    expect((await rows(ID.dono, "select storage_path from service_photos where service_id = $1 order by ordem", [corte])).map((r) => r.storage_path)).toEqual([1, 2, 3, 4, 5].map(foto))
  })

  it("remover uma foto libera vaga e devolve o caminho para apagar o arquivo", async () => {
    const [primeira] = await rows(ID.dono, "select id from service_photos where service_id = $1 order by ordem limit 1", [corte])
    expect(await val(ID.dono, "select remove_service_photo($1)", [primeira.id])).toBe(foto(1))
    await putObject(foto(7), "image/jpeg", 1000)
    await val(ID.dono, "select add_service_photo($1, $2)", [corte, foto(7)])
    expect(await rows(ID.dono, "select 1 from service_photos where service_id = $1", [corte])).toHaveLength(5)
  })

  it("recusa caminho de outro serviço, SVG, arquivo grande ou inexistente; barbeiro e cliente não gravam", async () => {
    await putObject(`${loja}/servico-${corte}-svg1.svg`, "image/svg+xml", 100)
    await expect(rows(ID.dono, "select add_service_photo($1, $2)", [corte, `${loja}/servico-${corte}-svg1.svg`])).rejects.toThrow(/invalid_media/)
    await expect(rows(ID.dono, "select add_service_photo($1, $2)", [corte, `${loja}/servico-${corte}-nao.jpg`])).rejects.toThrow(/media_not_found/)
    await expect(rows(ID.dono, "select add_service_photo($1, $2)", [corte, `${lojaB}/servico-${corte}-x.jpg`])).rejects.toThrow(/invalid_media/)
    await expect(rows(ID.barb, "select add_service_photo($1, $2)", [corte, foto(7)])).rejects.toThrow(/forbidden/)
    await expect(rows(ID.donoB, "select remove_service_photo(gen_random_uuid())")).rejects.toThrow(/forbidden/)
  })

  it("a tabela não é gravável pela API", async () => {
    await expect(rows(ID.dono, "insert into service_photos (barbershop_id, service_id, storage_path) values ($1, $2, 'x')", [loja, corte])).rejects.toThrow(/permission denied/)
  })
})

describe("foto de perfil do profissional", () => {
  it("o painel consegue LER avatar_path (a 0004 limita as colunas) e profile_id continua oculto", async () => {
    // regressão: sem o grant da coluna nova, a tela de Equipe dava 403
    expect(await rows(ID.dono, "select id, nome, ativo, avatar_path from professionals")).toHaveLength(1)
    expect(await rows(ID.barb, "select avatar_path from professionals")).toHaveLength(1)
    await expect(rows(ID.dono, "select profile_id from professionals")).rejects.toThrow(/permission denied/)
  })

  it("a gestão define a foto; caminho de outro profissional é recusado; a página pública expõe o caminho", async () => {
    const avatar = `${loja}/profissional-${ana}-ab12.png`
    await putObject(avatar, "image/png", 900)
    expect(await val(ID.dono, "select set_professional_avatar($1, $2)", [ana, avatar])).toBeNull()
    await putObject(`${loja}/profissional-${ana}-zz.png`, "image/png", 900)
    await expect(rows(ID.dono, "select set_professional_avatar($1, $2)", [ana, `${loja}/profissional-outro-zz.png`])).rejects.toThrow(/invalid_media/)
    await expect(rows(ID.barb, "select set_professional_avatar($1, $2)", [ana, avatar])).rejects.toThrow(/forbidden/)
    const shop = await val(null, "select get_public_shop('barbearia-a')")
    expect(shop.professionals.find((p: any) => p.id === ana).avatar_path).toBe(avatar)
  })

  it("a página pública traz as fotos de cada serviço em ordem", async () => {
    const shop = await val(null, "select get_public_shop('barbearia-a')")
    const svc = shop.services.find((s: any) => s.id === corte)
    expect(svc.fotos).toHaveLength(5)
    expect(svc.fotos[0]).toBe(`${loja}/servico-${corte}-f2.jpg`)
  })
})
