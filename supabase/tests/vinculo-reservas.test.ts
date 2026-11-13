/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Migration 0022: cadastro com WhatsApp e vínculo da reserva manual com a conta do cliente (e-mail confirmado + WhatsApp).
// T1 cadastro · T2 vínculo · T3 segurança. PostgreSQL local (PGlite) com todas as migrations; nada toca o banco remoto.
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), carlos: U("c1"), maria: U("d1"), pedro: U("d2"), joao: U("d3"), lucas: U("d4"), bruna: U("d5") }

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
let loja = "", corte = "", carlos = "", dia = ""
let livres: string[] = []

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user])
  await db.exec("set role authenticated")
  try {
    return await fn()
  } finally {
    await db.exec("reset role")
  }
}
const sql = async (q: string, p: unknown[] = []) => (await db.query<Record<string, any>>(q, p)).rows
const de = (user: string, q: string, p: unknown[] = []) => as(user, () => sql(q, p))
const conta = (id: string, email: string, meta: Record<string, unknown>, confirmado = true) =>
  sql("insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, $3, $4)", [id, email, confirmado ? new Date().toISOString() : null, meta])
const perfil = async (id: string) => (await sql("select nome, email, whatsapp from profiles where id = $1", [id]))[0]
let slotSeq = 0
const manual = async (nome: string, whatsapp: string, email: string | null) =>
  (await de(ID.dono, "select create_manual_booking($1, $2, $3, $4, $5, $6, true, $7, $8) id", [loja, corte, carlos, livres[(slotSeq++) * 4], nome, whatsapp, `k${slotSeq}`, email]))[0].id as string
const vincular = async (user: string) => Number((await de(user, "select link_my_bookings() n"))[0].n)
const donoDa = async (reserva: string) => (await sql("select customer_id from bookings where id = $1", [reserva]))[0].customer_id

beforeAll(async () => {
  await db.exec(AMBIENTE)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  await conta(ID.dono, "dono@example.test", { full_name: "Dono" })
  await conta(ID.carlos, "carlos@example.test", { full_name: "Carlos" })
  loja = (await de(ID.dono, "select create_barbershop('Barbearia Central', 'barbearia-central') id"))[0].id
  await sql("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'barbeiro')", [loja, ID.carlos])
  corte = (await de(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [loja]))[0].id
  carlos = (await de(ID.dono, "select save_professional($1, null, 'Carlos', true, $2) id", [loja, [corte]]))[0].id
  await de(ID.dono, "select link_professional($1, $2)", [carlos, ID.carlos])
  await de(ID.dono, "select save_working_hours($1, $2)", [carlos, JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))])
  dia = (await sql("select ((now() at time zone 'America/Sao_Paulo')::date + 2)::text d"))[0].d
  livres = (await sql("select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, carlos, dia])).map((r) => r.slot_inicio)
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("cadastro e vínculo de reservas", () => {
  it("T1 — cadastro salva nome, e-mail e WhatsApp; conta Google sem WhatsApp completa uma vez na reserva", async () => {
    await conta(ID.lucas, "lucas@example.test", { full_name: "Lucas Rocha", whatsapp: "+55 (64) 98888-1111" })
    expect(await perfil(ID.lucas)).toEqual({ nome: "Lucas Rocha", email: "lucas@example.test", whatsapp: "5564988881111" })

    await conta(ID.bruna, "bruna@example.test", { full_name: "Bruna Lima", whatsapp: "123" }) // número inválido não entra
    expect((await perfil(ID.bruna)).whatsapp).toBeNull()

    // Google: sem WhatsApp no cadastro; a primeira reserva preenche, e depois não troca mais
    await de(ID.bruna, "select fill_my_whatsapp('(11) 91234-5678')")
    await de(ID.bruna, "select fill_my_whatsapp('(21) 90000-0000')")
    expect((await perfil(ID.bruna)).whatsapp).toBe("11912345678")
    await expect(de(ID.bruna, "select fill_my_whatsapp('12')")).rejects.toThrow(/invalid_contact/)
  })

  it("T2 — reserva manual entra na conta da cliente só depois do e-mail confirmado, sem duplicar e sem perder o pagamento", async () => {
    const reserva = await manual("Maria Souza", "(64) 99275-0733", "  Maria.Souza@Example.TEST ")
    expect((await sql("select cliente_email from bookings where id = $1", [reserva]))[0].cliente_email).toBe("maria.souza@example.test")
    const pagamento = (await de(ID.dono, "select register_payment($1, 6000, 'pix', 1, 'pg-maria') id", [reserva]))[0].id

    await conta(ID.maria, "maria.souza@example.test", { full_name: "Maria Souza", whatsapp: "64 9275-0733" }, false) // sem o 9: mesma chave
    expect(await vincular(ID.maria)).toBe(0) // e-mail ainda não confirmado
    expect(await de(ID.maria, "select id from bookings")).toHaveLength(0)

    await sql("update auth.users set email_confirmed_at = now() where id = $1", [ID.maria])
    expect(await vincular(ID.maria)).toBe(1)
    expect((await de(ID.maria, "select id, customer_id from bookings")).map((b) => b.id)).toEqual([reserva])
    expect(await de(ID.maria, "select papel from memberships where barbershop_id = $1", [loja])).toEqual([{ papel: "cliente" }])
    expect((await sql("select booking_id from payments where id = $1", [pagamento]))[0].booking_id).toBe(reserva)

    expect(await vincular(ID.maria)).toBe(0) // repetir não faz nada
    expect((await sql("select count(*)::int n from bookings where id = $1", [reserva]))[0].n).toBe(1)
    expect((await sql("select count(*)::int n from booking_events where booking_id = $1 and tipo = 'linked'", [reserva]))[0].n).toBe(1)
  })

  it("T3 — dados conflitantes, outras contas e reserva com dono não são assumidos; gestão e barbeiro seguem iguais", async () => {
    // e-mail igual, WhatsApp diferente: suspeita de e-mail digitado errado, não vincula
    await conta(ID.pedro, "pedro@example.test", { full_name: "Pedro Alves", whatsapp: "(11) 98888-7777" })
    const dePedro = await manual("Pedro Alves", "(21) 97777-6666", "pedro@example.test")
    expect(await vincular(ID.pedro)).toBe(0)
    expect(await donoDa(dePedro)).toBeNull()

    // outra conta não vê nem cancela a reserva da Maria
    await conta(ID.joao, "joao@example.test", { full_name: "João Dias", whatsapp: "(31) 96666-5555" })
    const daMaria = (await sql("select id from bookings where customer_id = $1", [ID.maria]))[0].id
    expect(await de(ID.joao, "select id from bookings where id = $1", [daMaria])).toHaveLength(0)
    await expect(de(ID.joao, "select cancel_booking($1)", [daMaria])).rejects.toThrow(/forbidden/)

    // reserva que já tem dono não muda de conta, mesmo com e-mail e WhatsApp de outra pessoa
    await sql("update bookings set cliente_email = 'joao@example.test', cliente_whatsapp = '31966665555' where id = $1", [daMaria])
    expect(await vincular(ID.joao)).toBe(0)
    expect(await donoDa(daMaria)).toBe(ID.maria)

    // cliente não agenda pela barbearia; gestão vê tudo da loja; o barbeiro vê a agenda dele
    await expect(de(ID.maria, "select create_manual_booking($1, $2, $3, $4, 'X', '11912345678', false, null, null)", [loja, corte, carlos, livres[1]])).rejects.toThrow(/forbidden/)
    expect((await de(ID.dono, "select id from bookings where id = any($1)", [[daMaria, dePedro]])).length).toBe(2)
    expect((await de(ID.carlos, "select id from bookings where id = any($1)", [[daMaria, dePedro]])).length).toBe(2)
  })
})
