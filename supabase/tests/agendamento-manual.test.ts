/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Migration 0022: agendamento manual pela barbearia (cliente sem conta). Os 3 testes do plano:
// 1) reserva manual pelo dono aparece nas agendas e no financeiro; 2) permissões do barbeiro; 3) conflito de horário.
// PostgreSQL local (PGlite) com todas as migrations e os privilégios padrão do Supabase. Nada aqui toca o banco remoto.
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), carlos: U("c1"), joao: U("c2"), maria: U("d1") } // Carlos e João: barbeiros; Maria: cliente com conta

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
let loja = "", corte = "", ana = "", bia = "", dia = ""

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
const comoUsuario = (user: string, q: string, p: unknown[] = []) => as(user, () => sql(q, p))
const horarios = async (prof: string) => (await sql("select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, prof, dia])).map((r) => r.slot_inicio as string)
const manual = (user: string, prof: string, inicio: string, chave: string | null = null, nome = "Pedro Alves") =>
  comoUsuario(user, "select create_manual_booking($1, $2, $3, $4, $5, '(64) 99275-0733', true, $6) id", [loja, corte, prof, inicio, nome, chave]).then((r) => r[0].id as string)

beforeAll(async () => {
  await db.exec(AMBIENTE)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  loja = (await comoUsuario(ID.dono, "select create_barbershop('Barbearia Central', 'barbearia-central') id"))[0].id
  for (const b of [ID.carlos, ID.joao]) await sql("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'barbeiro')", [loja, b])
  corte = (await comoUsuario(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [loja]))[0].id
  ana = (await comoUsuario(ID.dono, "select save_professional($1, null, 'Carlos', true, $2) id", [loja, [corte]]))[0].id
  bia = (await comoUsuario(ID.dono, "select save_professional($1, null, 'João', true, $2) id", [loja, [corte]]))[0].id
  await comoUsuario(ID.dono, "select link_professional($1, $2)", [ana, ID.carlos])
  await comoUsuario(ID.dono, "select link_professional($1, $2)", [bia, ID.joao])
  const semana = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))
  for (const p of [ana, bia]) await comoUsuario(ID.dono, "select save_working_hours($1, $2)", [p, semana])
  await comoUsuario(ID.dono, "select save_commission_rule($1, $2, $3, 'percentual', 5000)", [loja, ana, corte])
  dia = (await sql("select ((now() at time zone 'America/Sao_Paulo')::date + 2)::text d"))[0].d
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("agendamento manual pela barbearia", () => {
  it("1) o dono agenda sem conta do cliente: entra na agenda da loja e do barbeiro e no financeiro", async () => {
    const [inicio] = await horarios(ana)
    const id = await manual(ID.dono, ana, inicio, "balcao-1")
    const [b] = await sql("select customer_id, status, cliente_nome, cliente_whatsapp, professional_id from bookings where id = $1", [id])
    expect(b).toMatchObject({ customer_id: null, status: "confirmado", cliente_nome: "Pedro Alves", cliente_whatsapp: "64992750733", professional_id: ana })
    expect(await manual(ID.dono, ana, inicio, "balcao-1")).toBe(id) // clique duplo: mesma reserva
    expect((await sql("select actor_id from booking_events where booking_id = $1 and tipo = 'created'", [id]))[0].actor_id).toBe(ID.dono)

    // agendas: gestão e o barbeiro escolhido veem; a reserva não aparece em "Minhas reservas" de ninguém
    expect((await comoUsuario(ID.dono, "select id from bookings where id = $1", [id])).length).toBe(1)
    expect((await comoUsuario(ID.carlos, "select id from bookings where id = $1", [id])).length).toBe(1)
    expect((await comoUsuario(ID.dono, "select id from bookings where id = $1 and customer_id = auth.uid()", [id])).length).toBe(0)

    // financeiro: o atendimento acontece, é concluído e pago; comissão e caixa somam como qualquer reserva
    await sql("update bookings set inicio = now() - interval '2 hours', fim = now() - interval '80 minutes' where id = $1", [id])
    await comoUsuario(ID.dono, "select set_booking_status($1, 'concluido')", [id])
    const pagamento = (await comoUsuario(ID.dono, "select register_payment($1, 6000, 'pix', 1, 'pg-balcao-1') id", [id]))[0].id
    await comoUsuario(ID.dono, "select confirm_payment($1)", [pagamento])
    expect((await sql("select professional_id, valor_centavos from commissions where booking_id = $1", [id]))[0]).toMatchObject({ professional_id: ana, valor_centavos: 3000 })
    const hoje = (await sql("select (now() at time zone 'America/Sao_Paulo')::date::text d"))[0].d
    const [rel] = await comoUsuario(ID.dono, "select * from finance_report($1, ($2::date - 3), ($2::date + 3))", [loja, hoje])
    expect(Number(rel.recebido_centavos)).toBe(6000)
    expect(Number(rel.comissoes_provisionadas_centavos) + Number(rel.comissoes_liquidadas_centavos)).toBe(3000)
  })

  it("2) barbeiro não agenda pela barbearia nem vê agenda ou ganhos de outro barbeiro", async () => {
    const [inicio] = await horarios(bia)
    await expect(manual(ID.carlos, bia, inicio)).rejects.toThrow(/forbidden/)
    await expect(manual(ID.carlos, ana, inicio)).rejects.toThrow(/forbidden/)
    const daBia = await manual(ID.dono, bia, inicio, "balcao-2", "Lucas Rocha")

    expect((await comoUsuario(ID.carlos, "select id from bookings where id = $1", [daBia])).length).toBe(0)
    expect((await comoUsuario(ID.joao, "select id from bookings where id = $1", [daBia])).length).toBe(1)
    const comissoesVistas = await comoUsuario(ID.joao, "select professional_id from commissions")
    expect(comissoesVistas.every((c) => c.professional_id === bia)).toBe(true) // João não vê a comissão do Carlos
    await expect(comoUsuario(ID.carlos, "select * from finance_report($1, current_date, current_date)", [loja])).rejects.toThrow(/forbidden/)
    await expect(comoUsuario(ID.maria, "select create_manual_booking($1, $2, $3, $4, 'Ana Lima', '11912345678', false, null)", [loja, corte, ana, inicio])).rejects.toThrow(/forbidden/)
  })

  it("3) horários: impede conflito e bloqueio, e a reserva pública continua funcionando", async () => {
    const livres = await horarios(ana)
    const ocupado = await manual(ID.dono, ana, livres[0], "balcao-3")
    expect((await horarios(ana))).not.toContain(livres[0]) // sai da lista pública
    await expect(manual(ID.dono, ana, livres[0], "balcao-4", "Rafael Dias")).rejects.toThrow(/slot_taken/)
    await expect(comoUsuario(ID.maria, "select create_booking($1, $2, $3, $4, 'Maria', '(64) 99275-0733', true, false, null)", [loja, corte, ana, livres[0]])).rejects.toThrow(/slot_taken/)

    const publica = (await comoUsuario(ID.maria, "select create_booking($1, $2, $3, $4, 'Maria', '(64) 99275-0733', true, false, null) id", [loja, corte, ana, livres[4]]))[0].id
    expect((await sql("select customer_id from bookings where id = $1", [publica]))[0].customer_id).toBe(ID.maria)
    await expect(manual(ID.dono, ana, livres[4], "balcao-5", "Rafael Dias")).rejects.toThrow(/slot_taken/)

    await comoUsuario(ID.dono, "select create_block($1, $2, $3::timestamptz, ($3::timestamptz + interval '2 hours'), 'Almoço')", [loja, ana, livres[8]])
    await expect(manual(ID.dono, ana, livres[8], "balcao-6", "Rafael Dias")).rejects.toThrow(/slot_taken/)
    expect(ocupado).toMatch(/^[0-9a-f-]{36}$/)
  })
})
