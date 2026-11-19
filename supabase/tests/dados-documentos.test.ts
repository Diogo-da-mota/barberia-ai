/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Migrations 0012 (dados da barbearia e fiscais) e 0013 (documentos privados), em PostgreSQL local (PGlite).
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
  try { return await fn() } finally { await db.exec("reset role") }
}
const rows = (user: string | null, sql: string, params: unknown[] = []) => as(user, async () => (await db.query<Record<string, any>>(sql, params)).rows)
const val = async (user: string | null, sql: string, params: unknown[] = []) => Object.values((await rows(user, sql, params))[0])[0] as any
const fails = async (user: string | null, sql: string, params: unknown[] = []) => { try { await rows(user, sql, params); return null } catch (e) { return String((e as Error).message) } }
const putDoc = (path: string, mime: string, size: number) => db.query("insert into storage.objects (bucket_id, name, metadata) values ('shop-documents', $1, $2)", [path, { mimetype: mime, size }])

const PROFILE = "select save_shop_profile($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)"
const profileArgs = (shop: string, over: Partial<Record<string, string>> = {}) => {
  const v = { nome: "Barbearia A", exib: "Tico Barbearia", desc: "Cortes clássicos", tel: "(67) 3322-4455", whats: "+55 67 99239-6649", mail: "contato@tico.com.br", cep: "79002-320", log: "Rua do Pombo", num: "123", comp: "Sala 2", bai: "Centro", cid: "Campo Grande", uf: "ms", ...over }
  return [shop, v.nome, v.exib, v.desc, v.tel, v.whats, v.mail, v.cep, v.log, v.num, v.comp, v.bai, v.cid, v.uf]
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
  for (const f of ["0001_identidade_inicial", "0002_catalogo", "0003_agenda", "0004_barbeiro", "0007_site", "0010_servico_imagem", "0011_site_template", "0012_dados_barbearia", "0013_documentos"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  lojaA = await val(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")
  lojaB = await val(ID.donoB, "select create_barbershop('Barbearia B', 'barbearia-b')")
  await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'gerente'), ($1, $3, 'barbeiro'), ($1, $4, 'cliente')", [lojaA, ID.gerente, ID.barb, ID.cli])
}, 60_000)

afterAll(async () => { await db.close() })

describe("CPF e CNPJ (dígitos verificadores no servidor)", () => {
  it("aceita documentos válidos e recusa inválidos, repetidos e de tamanho errado", async () => {
    const v = (fn: string, d: string) => db.query<{ ok: boolean }>(`select private.${fn}($1) as ok`, [d]).then((r) => r.rows[0].ok)
    expect(await v("valid_cpf", "52998224725")).toBe(true)
    expect(await v("valid_cpf", "52998224726")).toBe(false)
    expect(await v("valid_cpf", "11111111111")).toBe(false)
    expect(await v("valid_cpf", "1234")).toBe(false)
    expect(await v("valid_cnpj", "11222333000181")).toBe(true)
    expect(await v("valid_cnpj", "11222333000182")).toBe(false)
    expect(await v("valid_cnpj", "00000000000000")).toBe(false)
  })
})

describe("perfil da barbearia (0012)", () => {
  it("proprietário e gerente salvam; o endereço único é montado das partes e a página pública mostra o nome de exibição", async () => {
    await rows(ID.dono, PROFILE, profileArgs(lojaA))
    const shop = (await rows(ID.dono, "select * from barbershops where id = $1", [lojaA]))[0]
    expect(shop).toMatchObject({ nome: "Barbearia A", nome_exibicao: "Tico Barbearia", whatsapp: "5567992396649", telefone: "6733224455", cep: "79002320", uf: "MS", email_comercial: "contato@tico.com.br" })
    expect(shop.endereco).toBe("Rua do Pombo, 123 - Centro, Campo Grande - MS")
    const pub = await val(null, "select get_public_shop('barbearia-a')")
    expect(pub.nome).toBe("Tico Barbearia")
    expect(pub.template).toBe("urbano") // a 0011 continua valendo
    await rows(ID.gerente, PROFILE, profileArgs(lojaA, { exib: "", desc: "Nova" }))
    expect((await val(null, "select get_public_shop('barbearia-a')")).nome).toBe("Barbearia A") // sem nome de exibição, vale o nome
  })

  it("barbeiro, cliente, outra barbearia e visitante não gravam; dados inválidos são recusados", async () => {
    for (const user of [ID.barb, ID.cli, ID.donoB, null]) expect(await fails(user, PROFILE, profileArgs(lojaA)), String(user)).toBeTruthy()
    for (const bad of [{ nome: " " }, { mail: "sem-arroba" }, { whats: "123" }, { cep: "1234" }, { uf: "MSX" }, { desc: "x".repeat(501) }]) {
      expect(await fails(ID.dono, PROFILE, profileArgs(lojaA, bad)), JSON.stringify(bad)).toMatch(/invalid_shop/)
    }
  })

  it("as colunas novas não aceitam escrita direta", async () => {
    expect(await fails(ID.dono, "update barbershops set whatsapp = '67999999999' where id = $1", [lojaA])).toMatch(/permission denied/)
  })
})

describe("dados fiscais (0012): só o proprietário", () => {
  it("o proprietário grava e lê; CPF/CNPJ inválido é recusado", async () => {
    await rows(ID.dono, "select save_shop_fiscal($1, 'juridica', '11.222.333/0001-81', 'Barbearia A LTDA', 'Fulano', 'Isento')", [lojaA])
    const f = (await rows(ID.dono, "select * from barbershop_fiscal where barbershop_id = $1", [lojaA]))[0]
    expect(f).toMatchObject({ tipo_pessoa: "juridica", documento: "11222333000181", razao_social: "Barbearia A LTDA", inscricao_estadual: "Isento" })
    expect(await fails(ID.dono, "select save_shop_fiscal($1, 'juridica', '11222333000182', null, null, null)", [lojaA])).toMatch(/invalid_document/)
    expect(await fails(ID.dono, "select save_shop_fiscal($1, 'fisica', '11222333000181', null, null, null)", [lojaA])).toMatch(/invalid_document/)
    expect(await fails(ID.dono, "select save_shop_fiscal($1, 'outra', null, null, null, null)", [lojaA])).toMatch(/invalid_fiscal/)
    await rows(ID.dono, "select save_shop_fiscal($1, 'fisica', '529.982.247-25', null, 'Fulano', null)", [lojaA])
    expect(await val(ID.dono, "select documento from barbershop_fiscal where barbershop_id = $1", [lojaA])).toBe("52998224725")
  })

  it("gerente, barbeiro, cliente, visitante e outra barbearia não leem nem gravam", async () => {
    for (const user of [ID.gerente, ID.barb, ID.cli, ID.donoB]) {
      expect(await rows(user, "select * from barbershop_fiscal where barbershop_id = $1", [lojaA]), String(user)).toHaveLength(0)
      expect(await fails(user, "select save_shop_fiscal($1, 'fisica', null, null, null, null)", [lojaA]), String(user)).toBeTruthy()
    }
    expect(await fails(null, "select * from barbershop_fiscal")).toMatch(/permission denied/)
    expect(await fails(ID.dono, "insert into barbershop_fiscal (barbershop_id, tipo_pessoa) values ($1, 'fisica')", [lojaB])).toBeTruthy()
  })
})

describe("documentos privados (0013)", () => {
  const path = (shop: string, name: string) => `${shop}/${name}`
  it("o bucket é privado, só PDF/JPEG/PNG até 10 MB", async () => {
    const b = (await db.query<any>("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'shop-documents'")).rows[0]
    expect(b.public).toBe(false)
    expect(Number(b.file_size_limit)).toBe(10485760)
    expect(b.allowed_mime_types).toEqual(["application/pdf", "image/jpeg", "image/png"])
  })

  it("o proprietário registra um documento real; reenviar o mesmo tipo substitui e devolve o caminho antigo", async () => {
    await putDoc(path(lojaA, "alvara-1.pdf"), "application/pdf", 400_000)
    const first = await val(ID.dono, "select register_shop_document($1, 'alvara', $2, 'alvara.pdf')", [lojaA, path(lojaA, "alvara-1.pdf")])
    expect(first.old_path).toBeNull()
    await putDoc(path(lojaA, "alvara-2.pdf"), "application/pdf", 500_000)
    const second = await val(ID.dono, "select register_shop_document($1, 'alvara', $2, 'alvara-novo.pdf')", [lojaA, path(lojaA, "alvara-2.pdf")])
    expect(second.old_path).toBe(path(lojaA, "alvara-1.pdf"))
    const list = await rows(ID.dono, "select tipo, nome_arquivo, mime, tamanho_bytes from shop_documents where barbershop_id = $1", [lojaA])
    expect(list).toEqual([{ tipo: "alvara", nome_arquivo: "alvara-novo.pdf", mime: "application/pdf", tamanho_bytes: 500000 }])
  })

  it("recusa objeto inexistente, tipo/tamanho inválido, caminho de outra barbearia e tipo desconhecido", async () => {
    expect(await fails(ID.dono, "select register_shop_document($1, 'cnpj', $2, 'x.pdf')", [lojaA, path(lojaA, "nao-existe.pdf")])).toMatch(/document_not_found/)
    await putDoc(path(lojaA, "grande.pdf"), "application/pdf", 11 * 1024 * 1024)
    expect(await fails(ID.dono, "select register_shop_document($1, 'cnpj', $2, 'g.pdf')", [lojaA, path(lojaA, "grande.pdf")])).toMatch(/invalid_document_file/)
    await putDoc(path(lojaA, "script.exe"), "application/x-msdownload", 1000)
    expect(await fails(ID.dono, "select register_shop_document($1, 'cnpj', $2, 's.exe')", [lojaA, path(lojaA, "script.exe")])).toMatch(/invalid_document_file/)
    await putDoc(path(lojaB, "dela.pdf"), "application/pdf", 1000)
    expect(await fails(ID.dono, "select register_shop_document($1, 'cnpj', $2, 'd.pdf')", [lojaA, path(lojaB, "dela.pdf")])).toMatch(/invalid_document_file/)
    await putDoc(path(lojaA, "ok.pdf"), "application/pdf", 1000)
    expect(await fails(ID.dono, "select register_shop_document($1, 'selfie', $2, 'o.pdf')", [lojaA, path(lojaA, "ok.pdf")])).toMatch(/invalid_document_file/)
  })

  it("gerente, barbeiro, cliente, visitante e proprietário de outra barbearia não leem, registram nem removem", async () => {
    await putDoc(path(lojaA, "x.pdf"), "application/pdf", 1000)
    const id = await val(ID.dono, "select register_shop_document($1, 'contrato_social', $2, 'x.pdf') ->> 'id'", [lojaA, path(lojaA, "x.pdf")])
    for (const user of [ID.gerente, ID.barb, ID.cli, ID.donoB]) {
      expect(await rows(user, "select * from shop_documents where barbershop_id = $1", [lojaA]), String(user)).toHaveLength(0)
      expect(await fails(user, "select register_shop_document($1, 'outro', $2, 'x.pdf')", [lojaA, path(lojaA, "x.pdf")]), String(user)).toBeTruthy()
      expect(await fails(user, "select delete_shop_document($1)", [id]), String(user)).toBeTruthy()
      expect(await rows(user, "select name from storage.objects where bucket_id = 'shop-documents' and name like $1", [`${lojaA}/%`]), `storage ${user}`).toHaveLength(0)
    }
    expect(await fails(null, "select * from shop_documents")).toMatch(/permission denied/)
    expect((await rows(ID.dono, "select name from storage.objects where bucket_id = 'shop-documents'")).length).toBeGreaterThan(0)
  })

  it("remover apaga o registro e devolve o caminho; 'outro' aceita vários, até 10", async () => {
    const id = (await rows(ID.dono, "select id from shop_documents where tipo = 'contrato_social'"))[0].id
    expect(await val(ID.dono, "select delete_shop_document($1)", [id])).toBe(path(lojaA, "x.pdf"))
    expect(await rows(ID.dono, "select 1 from shop_documents where id = $1", [id])).toHaveLength(0)
    for (let i = 0; i < 10; i++) {
      await putDoc(path(lojaA, `outro-${i}.png`), "image/png", 2000)
      await rows(ID.dono, "select register_shop_document($1, 'outro', $2, $3)", [lojaA, path(lojaA, `outro-${i}.png`), `outro-${i}.png`])
    }
    await putDoc(path(lojaA, "outro-11.png"), "image/png", 2000)
    expect(await fails(ID.dono, "select register_shop_document($1, 'outro', $2, 'o.png')", [lojaA, path(lojaA, "outro-11.png")])).toMatch(/document_limit/)
  })
})

describe("envio direto ao Storage (0052)", () => {
  let lojaC = ""
  const put = (user: string, bucket: string, name: string) =>
    rows(user, "insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3) returning name", [bucket, name, { mimetype: "application/pdf", size: 1000 }])
  beforeAll(async () => {
    await db.exec(readFileSync("supabase/migrations/0052_storage_envio_direto.sql", "utf8"))
    lojaC = await val(ID.dono, "select create_barbershop('Barbearia C', 'barbearia-c')")
  })

  it("o bucket antigo site-media não aceita mais envio nem troca de arquivo; ler e apagar o que já existe continuam", async () => {
    await db.query("insert into storage.objects (bucket_id, name, metadata) values ('site-media', $1, '{}')", [`${lojaA}/antiga.png`])
    for (const user of [ID.dono, ID.gerente]) expect(await fails(user, "insert into storage.objects (bucket_id, name) values ('site-media', $1)", [`${lojaA}/nova.png`]), user).toMatch(/row-level security/)
    expect(await rows(ID.dono, "update storage.objects set metadata = '{}' where bucket_id = 'site-media' and name = $1 returning name", [`${lojaA}/antiga.png`])).toHaveLength(0)
    expect(await rows(null, "select name from storage.objects where bucket_id = 'site-media' and name = $1", [`${lojaA}/antiga.png`])).toHaveLength(1)
    expect(await rows(ID.dono, "delete from storage.objects where bucket_id = 'site-media' and name = $1 returning name", [`${lojaA}/antiga.png`])).toHaveLength(1)
  })

  it("shop-documents: o proprietário envia até 20 arquivos por barbearia; o 21º é recusado e apagar um libera a vaga", async () => {
    for (let i = 0; i < 20; i++) await put(ID.dono, "shop-documents", `${lojaC}/doc-${i}.pdf`)
    expect(await fails(ID.dono, "insert into storage.objects (bucket_id, name) values ('shop-documents', $1)", [`${lojaC}/doc-20.pdf`])).toMatch(/row-level security/)
    expect(await rows(ID.dono, "delete from storage.objects where bucket_id = 'shop-documents' and name = $1 returning name", [`${lojaC}/doc-0.pdf`])).toHaveLength(1)
    expect(await put(ID.dono, "shop-documents", `${lojaC}/doc-20.pdf`)).toHaveLength(1)
  })

  it("o limite é por barbearia e o envio continua só do proprietário", async () => {
    expect(await put(ID.dono, "shop-documents", `${lojaA}/mais-um.pdf`)).toHaveLength(1)
    expect(await put(ID.donoB, "shop-documents", `${lojaB}/dela-2.pdf`)).toHaveLength(1)
    for (const user of [ID.gerente, ID.donoB]) expect(await fails(user, "insert into storage.objects (bucket_id, name) values ('shop-documents', $1)", [`${lojaA}/intruso.pdf`]), user).toMatch(/row-level security/)
  })
})
