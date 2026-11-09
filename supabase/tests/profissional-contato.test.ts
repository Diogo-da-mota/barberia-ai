/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Contato do profissional: telefone (Brasil), e-mail e CPF/CNPJ (migration 0002), com leitura só pela gestão.
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite({ extensions: { btree_gist } })
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), donoB: U("b1"), barb: U("c1"), cli: U("d1") }
let loja = "", lojaB = "", ana = ""

async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""])
  await db.exec(`set role ${user ? "authenticated" : "anon"}`)
  try { return await fn() } finally { await db.exec("reset role") }
}
const rows = (user: string | null, sql: string, params: unknown[] = []) => as(user, async () => (await db.query<Record<string, any>>(sql, params)).rows)
const val = async (user: string | null, sql: string, params: unknown[] = []) => Object.values((await rows(user, sql, params))[0])[0] as any
const salvar = (user: string, tel: string | null, email: string | null, doc: string | null) =>
  rows(user, "select save_professional_contact($1, $2, $3, $4)", [ana, tel, email, doc])
const contato = async () => (await rows(ID.dono, "select * from get_professional_contacts($1)", [loja])).find((r) => r.professional_id === ana)!

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `)
  for (const f of ["0001_identidade_inicial", "0002_catalogo", "0003_agenda", "0004_barbeiro"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  loja = await val(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")
  lojaB = await val(ID.donoB, "select create_barbershop('Barbearia B', 'barbearia-b')")
  await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'barbeiro'), ($1, $3, 'cliente')", [loja, ID.barb, ID.cli])
  ana = await val(ID.dono, "select save_professional($1, null, 'Ana', true, '{}')", [loja])
  expect(lojaB).toBeTruthy()
}, 60_000)

afterAll(async () => { await db.close() })

describe("telefone no formato do Brasil", () => {
  it("aceita +55 00 00000-0000, 00 0000-0000 e variações; guarda só os dígitos, sem o 55", async () => {
    for (const [entrada, guardado] of [
      ["+55 11 91234-5678", "11912345678"],
      ["11 91234-5678", "11912345678"],
      ["(11) 3234-5678", "1132345678"],
      ["+55 11 3234-5678", "1132345678"],
      ["5511912345678", "11912345678"],
      ["55 99999-0000", "55999990000"], // 55 é DDD (RS): com 11 dígitos não é prefixo do país
    ] as const) {
      await salvar(ID.dono, entrada, null, null)
      expect((await contato()).telefone, entrada).toBe(guardado)
    }
  })
  it("recusa número impossível", async () => {
    for (const ruim of ["123", "11 1234-5678", "01 91234-5678", "11 81234-5678 9", "abcdefghij", "+55 11 91234-567"]) {
      await expect(salvar(ID.dono, ruim, null, null), ruim).rejects.toThrow(/invalid_phone/)
    }
  })
  it("vazio limpa o campo", async () => {
    await salvar(ID.dono, "", "", "")
    expect(await contato()).toMatchObject({ telefone: null, email: null, documento: null })
  })
})

describe("e-mail e documento", () => {
  it("valida e-mail e guarda em minúsculas", async () => {
    await salvar(ID.dono, null, "  Ana@Exemplo.COM ", null)
    expect((await contato()).email).toBe("ana@exemplo.com")
    for (const ruim of ["sem-arroba", "a@b", "a b@c.com", "@x.com"]) await expect(salvar(ID.dono, null, ruim, null), ruim).rejects.toThrow(/invalid_email/)
  })
  it("CPF e CNPJ com dígito verificador (com ou sem máscara)", async () => {
    await salvar(ID.dono, null, null, "529.982.247-25")
    expect((await contato()).documento).toBe("52998224725")
    await salvar(ID.dono, null, null, "11.222.333/0001-81")
    expect((await contato()).documento).toBe("11222333000181")
    for (const ruim of ["52998224726", "111.111.111-11", "11222333000182", "00000000000000", "123", "529982247250"]) {
      await expect(salvar(ID.dono, null, null, ruim), ruim).rejects.toThrow(/invalid_document/)
    }
  })
})

describe("quem lê e quem grava", () => {
  it("só a gestão da própria barbearia grava e lê o contato", async () => {
    await salvar(ID.dono, "11 91234-5678", "ana@exemplo.com", "52998224725")
    for (const u of [ID.barb, ID.cli, ID.donoB]) {
      await expect(salvar(u, null, null, null)).rejects.toThrow(/forbidden/)
      await expect(rows(u, "select * from get_professional_contacts($1)", [loja])).rejects.toThrow(/forbidden/)
    }
  })
  it("a API não lê telefone, e-mail nem documento direto da tabela, nem a página pública", async () => {
    for (const u of [ID.dono, ID.barb, ID.cli]) {
      for (const col of ["telefone", "email", "documento", "profile_id"]) {
        await expect(rows(u, `select ${col} from professionals`), col).rejects.toThrow(/permission denied/)
      }
      expect((await rows(u, "select id, nome, ativo, avatar_path from professionals")).length).toBe(1)
    }
  })
})
