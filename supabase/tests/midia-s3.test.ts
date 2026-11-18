/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Fotos no AWS S3 (migration 0023): pasta certa da barbearia, uma foto por posição, galeria até 20, leitura pública do login.
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { limparOrfaos } from "../functions/_shared/media-cleanup"

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

describe("cota de envio e limpeza dos órfãos no S3 (0041)", () => {
  // As funções são do servidor (service_role); o superusuário do teste faz o papel da Edge Function.
  const reservar = (shop: string, k: string) => db.query("select reserve_media_upload($1, $2, $3)", [shop, k, ID.dono])
  const orfaos = async () => (await db.query<{ key: string }>("select key from list_orphan_media(500)")).rows.map((r) => r.key)
  const envelhecer = (keys: string[]) => db.query("update media_uploads set criado_em = now() - interval '25 hours' where key = any($1)", [keys])
  const marcar = async (keys: string[]) => (await db.query<{ n: number }>("select mark_media_removed($1) n", [keys])).rows[0].n

  beforeAll(async () => {
    await db.exec("do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;")
    await db.exec(readFileSync("supabase/migrations/0041_midia_cota.sql", "utf8"))
  })

  it("só o servidor anota, lista e marca envios; a chave precisa ser da própria barbearia", async () => {
    for (const u of [ID.dono, null]) {
      await expect(rows(u, "select reserve_media_upload($1, $2, $3)", [loja, key(loja, "site/galeria"), ID.dono])).rejects.toThrow(/permission denied/)
      await expect(rows(u, "select * from list_orphan_media(10)")).rejects.toThrow(/permission denied/)
      await expect(rows(u, "select mark_media_removed($1)", [[key(loja, "site/galeria")]])).rejects.toThrow(/permission denied/)
      await expect(rows(u, "select * from media_uploads")).rejects.toThrow(/permission denied/)
    }
    await expect(reservar(loja, key(lojaB, "site/galeria"))).rejects.toThrow(/invalid_media/)
    for (const k of [`BARBEARIA/${loja}/../${lojaB}/site/galeria/x.jpg`, `BARBEARIA/${loja}/site//galeria/x.jpg`, `BARBEARIA/${loja}/./x.jpg`]) {
      await expect(reservar(loja, k)).rejects.toThrow(/invalid_media/)
    }
  })

  it("no máximo 30 envios sem registro em 24 h; registrar ou apagar libera a vaga; a outra barbearia não é afetada", async () => {
    const pendentes = Array.from({ length: 30 }, () => key(lojaB, "site/galeria"))
    for (const k of pendentes) await reservar(lojaB, k)
    await expect(reservar(lojaB, key(lojaB, "site/galeria"))).rejects.toThrow(/upload_limit/)
    await reservar(loja, key(loja, "site/galeria"))
    await register(ID.donoB, lojaB, "galeria", pendentes[0])
    expect(await marcar([pendentes[1], pendentes[0]])).toBe(1) // a foto registrada nunca é marcada como removida
    await reservar(lojaB, key(lojaB, "site/galeria"))
    await reservar(lojaB, key(lojaB, "site/galeria"))
    await expect(reservar(lojaB, key(lojaB, "site/galeria"))).rejects.toThrow(/upload_limit/)
  })

  it("no máximo 200 envios em 24 h por barbearia, registrados ou não; passadas 24 h a cota volta", async () => {
    await db.query("insert into media_uploads (key, barbershop_id, removido_em) select 'BARBEARIA/' || $1 || '/site/galeria/' || gen_random_uuid() || '.jpg', $1::uuid, now() from generate_series(1, 200)", [loja])
    await expect(reservar(loja, key(loja, "site/galeria"))).rejects.toThrow(/upload_limit/)
    await db.query("update media_uploads set criado_em = now() - interval '25 hours' where barbershop_id = $1", [loja])
    await reservar(loja, key(loja, "site/galeria"))
  })

  it("órfão = anotado, com mais de 24 h, sem registro e não apagado; imagem em uso (site, serviço, profissional) e imagem antiga nunca entram", async () => {
    const orfao = key(loja, "site/galeria"), recente = key(loja, "site/galeria"), logo = key(loja, "site/logo")
    const servico = key(loja, `servicos/${corte}`), fotoServico = key(loja, `servicos/${corte}`), avatar = key(loja, `profissionais/${ana}`)
    for (const k of [orfao, recente, logo, servico, fotoServico, avatar]) await reservar(loja, k)
    await register(ID.dono, loja, "logo", logo)
    await val(ID.dono, "select set_service_image($1, $2)", [corte, servico])
    await val(ID.dono, "select add_service_photo($1, $2)", [corte, fotoServico])
    await val(ID.dono, "select set_professional_avatar($1, $2)", [ana, avatar])
    await envelhecer([orfao, logo, servico, fotoServico, avatar])
    const lista = await orfaos()
    expect(lista).toContain(orfao)
    for (const k of [recente, logo, servico, fotoServico, avatar]) expect(lista).not.toContain(k)
    const emUso = (await db.query<{ p: string }>("select storage_path p from media_objects union select imagem_path from services where imagem_path is not null union select storage_path from service_photos union select avatar_path from professionals where avatar_path is not null")).rows.map((r) => r.p)
    expect(lista.filter((k) => emUso.includes(k))).toEqual([])
    expect(await marcar([orfao, logo])).toBe(1)
    expect(await orfaos()).not.toContain(orfao)
  })

  it("limparOrfaos (media-migrate, acao 'limpar-orfaos') apaga só o que o banco listou e marca só o que o S3 confirmou", async () => {
    const velho = key(loja, "site/galeria"), falha = key(loja, "site/galeria")
    for (const k of [velho, falha]) await reservar(loja, k)
    await envelhecer([velho, falha])
    const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
      const nomes = Object.keys(args)
      try {
        const r = await db.query<Record<string, any>>(`select * from ${fn}(${nomes.map((x, i) => `${x} => $${i + 1}`).join(", ")})`, nomes.map((x) => args[x]))
        return { data: r.rows, error: null }
      } catch (err) {
        return { data: null, error: { message: (err as Error).message } }
      }
    }
    const apagadas: string[] = []
    const antes = await orfaos()
    const r = await limparOrfaos(rpc, async (k) => {
      if (k === falha) throw new Error("s3_indisponivel")
      apagadas.push(k)
    })
    expect(r).toEqual({ encontrados: antes.length, apagados: antes.length - 1, falhas: 1 })
    expect(apagadas).toContain(velho)
    expect(apagadas).not.toContain(falha)
    expect(await orfaos()).toEqual([falha]) // a que falhou volta na próxima limpeza
    await expect(limparOrfaos(async () => ({ data: null, error: { message: "x" } }), async () => {})).rejects.toThrow(/list_orphan_media/)
  })
})
