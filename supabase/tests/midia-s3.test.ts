/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Fotos no AWS S3 (migration 0023): pasta certa da barbearia, uma foto por posição, galeria até 20, leitura pública do login.
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite({ extensions: { btree_gist } })
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), donoB: U("b1"), barb: U("c1"), cli: U("d1") }
let loja = "", lojaB = "", corte = "", ana = ""
let n = 0
/** Nome único como o da função `media` (uuid minúsculo). */
const key = (shop: string, folder: string, ext = "jpg") => `BARBEARIA/${shop}/${folder}/00000000-0000-4000-8000-${String(++n).padStart(12, "0")}.${ext}`

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
const register = (user: string, shop: string, kind: string, path: string, size = 1000) =>
  val(user, "select register_media($1, $2, $3, $4)", [shop, kind, path, size])

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
  for (const f of ["0001_identidade_inicial", "0002_catalogo", "0003_agenda", "0004_barbeiro", "0007_site", "0010_servico_imagem", "0023_midia_s3"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  for (const [nome, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${nome}@example.test`, { full_name: nome }])
  loja = await val(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")
  lojaB = await val(ID.donoB, "select create_barbershop('Barbearia B', 'barbearia-b')")
  await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'barbeiro')", [loja, ID.barb])
  await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'cliente')", [loja, ID.cli])
  corte = (await rows(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [loja]))[0].id
  ana = (await db.query<{ id: string }>("insert into professionals (barbershop_id, nome) values ($1, 'Ana') returning id", [loja])).rows[0].id
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("fotos do site, do painel e do login (register_media)", () => {
  it("cada tipo só aceita a sua pasta da própria barbearia, com nome único e jpg/png/webp", async () => {
    const pastas = { logo: "site/logo", capa: "site/capa", painel_inicio: "painel/inicio", painel_agendamentos: "painel/agendamentos", painel_servicos: "painel/servicos", painel_sidebar: "painel/sidebar", painel_financeiro: "painel/financeiro", login_cliente: "login" }
    for (const [kind, folder] of Object.entries(pastas)) await expect(register(ID.dono, loja, kind, key(loja, folder, "png"))).resolves.toBeNull()
    const ruins = [
      ["logo", key(loja, "site/capa")], // pasta de outro tipo
      ["logo", key(lojaB, "site/logo")], // pasta de outra barbearia
      ["logo", `${loja}/logo-abc.png`], // caminho antigo (Supabase): novas fotos só no S3
      ["logo", `BARBEARIA/${loja}/site/logo/foto.png`], // nome que não é único
      ["logo", key(loja, "site/logo", "svg")],
      ["capa", `BARBEARIA/${loja}/site/capa/../logo/00000000-0000-4000-8000-000000000999.jpg`],
      ["outro", key(loja, "site/logo")],
    ]
    for (const [kind, path] of ruins) await expect(register(ID.dono, loja, kind, path), path).rejects.toThrow(/invalid_media/)
    await expect(register(ID.dono, loja, "logo", key(loja, "site/logo"), 0)).rejects.toThrow(/invalid_media/)
    await expect(register(ID.dono, loja, "logo", key(loja, "site/logo"), 2 * 1024 * 1024 + 1)).rejects.toThrow(/invalid_media/)
  })

  it("trocar mantém um registro por posição e devolve o arquivo antigo para apagar", async () => {
    const primeira = key(loja, "painel/sidebar")
    await register(ID.dono, loja, "painel_sidebar", primeira) // a do teste anterior é devolvida aqui
    const segunda = key(loja, "painel/sidebar", "webp")
    expect(await register(ID.dono, loja, "painel_sidebar", segunda)).toBe(primeira)
    const atuais = await rows(ID.dono, "select storage_path, mime from media_objects where barbershop_id = $1 and kind = 'painel_sidebar'", [loja])
    expect(atuais).toEqual([{ storage_path: segunda, mime: "image/webp" }])
  })

  it("galeria: até 20 fotos", async () => {
    for (let i = 0; i < 20; i++) await expect(register(ID.dono, loja, "galeria", key(loja, "site/galeria"))).resolves.toBeNull()
    await expect(register(ID.dono, loja, "galeria", key(loja, "site/galeria"))).rejects.toThrow(/media_limit/)
    expect(await val(ID.dono, "select count(*)::int from media_objects where barbershop_id = $1 and kind = 'galeria'", [loja])).toBe(20)
  })

  it("só a gestão da própria barbearia registra; barbeiro, cliente, outra barbearia e visitante não", async () => {
    for (const user of [ID.barb, ID.cli, ID.donoB]) await expect(register(user, loja, "capa", key(loja, "site/capa")), user).rejects.toThrow(/forbidden/)
    await expect(as(null, () => db.query("select register_media($1, 'capa', $2, 1000)", [loja, key(loja, "site/capa")]))).rejects.toThrow(/permission denied/)
  })

  it("a equipe lê as fotos do painel; o cliente não", async () => {
    expect((await rows(ID.barb, "select kind from media_objects where barbershop_id = $1 and kind = 'painel_inicio'", [loja])).length).toBe(1)
    expect(await rows(ID.cli, "select kind from media_objects where barbershop_id = $1", [loja])).toEqual([])
  })
})

describe("foto do login do cliente na página da barbearia", () => {
  it("o visitante lê só o caminho da foto do login, e só de barbearia ativa", async () => {
    const atual = await val(ID.dono, "select storage_path from media_objects where barbershop_id = $1 and kind = 'login_cliente'", [loja])
    expect(await val(null, "select get_shop_login_photo('barbearia-a')")).toBe(atual)
    expect(await val(null, "select get_shop_login_photo('barbearia-b')")).toBeNull()
    await db.query("update barbershops set status = 'inativo' where id = $1", [loja])
    expect(await val(null, "select get_shop_login_photo('barbearia-a')")).toBeNull()
    await db.query("update barbershops set status = 'ativo' where id = $1", [loja])
  })
})

describe("fotos do serviço e do profissional", () => {
  it("serviço: só na pasta do próprio serviço; trocar devolve a antiga", async () => {
    const a = key(loja, `servicos/${corte}`)
    expect(await val(ID.dono, "select set_service_image($1, $2)", [corte, a])).toBeNull()
    const b = key(loja, `servicos/${corte}`, "png")
    expect(await val(ID.dono, "select set_service_image($1, $2)", [corte, b])).toBe(a)
    await expect(val(ID.dono, "select set_service_image($1, $2)", [corte, key(loja, `servicos/${ana}`)])).rejects.toThrow(/invalid_media/)
    await expect(val(ID.dono, "select add_service_photo($1, $2)", [corte, key(loja, "site/galeria")])).rejects.toThrow(/invalid_media/)
    await expect(val(ID.dono, "select add_service_photo($1, $2)", [corte, key(loja, `servicos/${corte}`)])).resolves.toBeTruthy()
    await expect(val(ID.barb, "select set_service_image($1, $2)", [corte, key(loja, `servicos/${corte}`)])).rejects.toThrow(/forbidden/)
  })

  it("profissional: só na pasta do próprio profissional; trocar devolve a antiga", async () => {
    const a = key(loja, `profissionais/${ana}`)
    expect(await val(ID.dono, "select set_professional_avatar($1, $2)", [ana, a])).toBeNull()
    expect(await val(ID.dono, "select set_professional_avatar($1, $2)", [ana, key(loja, `profissionais/${ana}`)])).toBe(a)
    await expect(val(ID.dono, "select set_professional_avatar($1, $2)", [ana, key(lojaB, `profissionais/${ana}`)])).rejects.toThrow(/invalid_media/)
    await expect(val(ID.donoB, "select set_professional_avatar($1, $2)", [ana, key(loja, `profissionais/${ana}`)])).rejects.toThrow(/forbidden/)
  })
})
