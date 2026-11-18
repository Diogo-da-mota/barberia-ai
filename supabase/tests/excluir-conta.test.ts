/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Exclusão da própria conta (LGPD, migration 0056) em PostgreSQL local (PGlite), com contas e reservas fictícias.
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), carlos: U("c1"), maria: U("d1"), joao: U("d2"), maria2: U("d3") }

const AMBIENTE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  alter table storage.objects enable row level security;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`

const db = new PGlite({ extensions: { btree_gist } })
let loja = "", corte = "", carlos = ""
let livres: string[] = []
let seq = 0

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
const sql = async (q: string, p: unknown[] = []) => (await db.query<Record<string, any>>(q, p)).rows
const de = (user: string | null, q: string, p: unknown[] = []) => as(user, () => sql(q, p))
const falha = async (user: string | null, q: string) => { try { await de(user, q); return null } catch (e) { return String((e as Error).message) } }
const conta = (id: string, email: string, nome: string) =>
  sql("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, email, { full_name: nome }])
/** Reserva feita pelo próprio cliente (como no site), num horário livre. */
const reservar = async (user: string, nome: string, whatsapp: string) =>
  (await de(user, "select create_booking($1, $2, $3, $4, $5, $6, true, false, $7) id", [loja, corte, carlos, livres[(seq++) * 4], nome, whatsapp, `k${seq}`]))[0].id as string
/** Leva a reserva para o passado, já atendida (como ficaria depois do atendimento). */
const atendida = (id: string) => sql("update bookings set inicio = now() - interval '3 days', fim = now() - interval '3 days' + interval '40 minutes', status = 'concluido' where id = $1", [id])

beforeAll(async () => {
  await db.exec(AMBIENTE)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  await conta(ID.dono, "dono@example.test", "Dono")
  await conta(ID.carlos, "carlos@example.test", "Carlos")
  await conta(ID.maria, "maria@example.test", "Maria")
  await conta(ID.joao, "joao.silva@example.test", "João Silva")
  loja = (await de(ID.dono, "select create_barbershop('Barbearia Central', 'barbearia-central') id"))[0].id
  await sql("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'barbeiro')", [loja, ID.carlos])
  corte = (await de(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [loja]))[0].id
  carlos = (await de(ID.dono, "select save_professional($1, null, 'Carlos', true, $2) id", [loja, [corte]]))[0].id
  await de(ID.dono, "select link_professional($1, $2)", [carlos, ID.carlos])
  await de(ID.dono, "select save_working_hours($1, $2)", [carlos, JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))])
  const dia = (await sql("select ((now() at time zone 'America/Sao_Paulo')::date + 2)::text d"))[0].d
  livres = (await sql("select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, carlos, dia])).map((r) => r.slot_inicio)
}, 60_000)

afterAll(async () => { await db.close() })

describe("excluir a própria conta (0056)", () => {
  let reservaMaria = "", reservaJoao = ""
  let joaoAntes: Record<string, any> = {}

  it("cliente com reserva futura não exclui: precisa cancelar antes; nada muda", async () => {
    reservaMaria = await reservar(ID.maria, "Maria", "+55 64 99275-0733")
    expect(await falha(ID.maria, "select delete_my_account()")).toMatch(/has_upcoming_bookings/)
    expect(await sql("select 1 from auth.users where id = $1", [ID.maria])).toHaveLength(1)
    expect((await sql("select cliente_nome from bookings where id = $1", [reservaMaria]))[0].cliente_nome).toBe("Maria")
  })

  it("cliente exclui a conta: some o login e o perfil; a reserva antiga fica sem dados pessoais e os avisos sem telefone", async () => {
    reservaJoao = await reservar(ID.joao, "João Silva", "+55 64 98888-1111")
    joaoAntes = (await sql("select customer_id, cliente_nome, cliente_whatsapp, cliente_email from bookings where id = $1", [reservaJoao]))[0]
    await atendida(reservaMaria)
    await de(ID.maria, "select delete_my_account()")
    expect(await sql("select 1 from auth.users where id = $1", [ID.maria])).toHaveLength(0)
    expect(await sql("select 1 from profiles where id = $1", [ID.maria])).toHaveLength(0)
    expect(await sql("select 1 from memberships where profile_id = $1", [ID.maria])).toHaveLength(0)
    expect((await sql("select customer_id, cliente_nome, cliente_whatsapp, cliente_email, status from bookings where id = $1", [reservaMaria]))[0])
      .toEqual({ customer_id: null, cliente_nome: "Cliente removido", cliente_whatsapp: "", cliente_email: null, status: "concluido" })
    const avisos = await sql("select destino, payload, status from outbox_events where booking_id = $1", [reservaMaria])
    expect(avisos.length).toBeGreaterThan(0)
    for (const a of avisos) {
      expect(a).toMatchObject({ destino: "removido", payload: {} })
      expect(["pendente", "enviando"]).not.toContain(a.status)
    }
  })

  it("os dados de outro cliente não mudam", async () => {
    expect((await sql("select customer_id, cliente_nome, cliente_whatsapp, cliente_email from bookings where id = $1", [reservaJoao]))[0]).toEqual(joaoAntes)
    expect(joaoAntes).toMatchObject({ customer_id: ID.joao, cliente_nome: "João Silva" })
    expect(await sql("select 1 from auth.users where id = $1", [ID.joao])).toHaveLength(1)
    expect((await sql("select destino from outbox_events where booking_id = $1 limit 1", [reservaJoao]))[0].destino).not.toBe("removido")
  })

  it("conta nova com o mesmo e-mail e WhatsApp não recupera as reservas removidas", async () => {
    await sql("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'maria@example.test', $2)", [ID.maria2, { full_name: "Maria", whatsapp: "+55 64 99275-0733" }])
    expect(Number((await de(ID.maria2, "select link_my_bookings() n"))[0].n)).toBe(0)
    expect((await sql("select customer_id from bookings where id = $1", [reservaMaria]))[0].customer_id).toBeNull()
  })

  it("dono de barbearia não exclui a conta por aqui", async () => {
    expect(await falha(ID.dono, "select delete_my_account()")).toMatch(/owner_cannot_delete/)
    expect(await sql("select 1 from auth.users where id = $1", [ID.dono])).toHaveLength(1)
  })

  it("barbeiro exclui a conta: o card continua na equipe, sem a conta ligada", async () => {
    await atendida(reservaJoao)
    await de(ID.carlos, "select delete_my_account()")
    expect(await sql("select 1 from auth.users where id = $1", [ID.carlos])).toHaveLength(0)
    expect((await sql("select profile_id, nome from professionals where id = $1", [carlos]))[0]).toEqual({ profile_id: null, nome: "Carlos" })
  })

  it("visitante sem login não consegue chamar", async () => {
    expect(await falha(null, "select delete_my_account()")).toMatch(/permission denied/)
  })
})
