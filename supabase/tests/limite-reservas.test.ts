/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Migration 0021 (segurança, etapa 2): limite por conta na create_booking e teto de avisos de reserva por telefone.
// PostgreSQL local (PGlite) com todas as migrations e os privilégios padrão do Supabase. Nada aqui toca o banco remoto.
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { donoA: U("a1"), donoB: U("b1"), barbA: U("c1"), maria: U("d1"), joao: U("d2"), atac1: U("e1"), atac2: U("e2"), atac3: U("e3") }

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
let lojaA = "", lojaB = "", corteA = "", corteB = "", anaA = "", beaB = ""
let chaveSeq = 0

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

/** Reserva daqui a 10 dias (fora da janela de cancelamento), no primeiro horário livre. */
async function reservar(loja: string, cliente: string, fone: string, chave: string | null = `k${++chaveSeq}`): Promise<string> {
  const [corte, prof] = loja === lojaA ? [corteA, anaA] : [corteB, beaB]
  const dia = (await sql("select ((now() at time zone 'America/Sao_Paulo')::date + 10)::text d"))[0].d
  const slots = await sql("select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, prof, dia])
  const [r] = await as(cliente, () => sql("select create_booking($1, $2, $3, $4, 'Maria', $5, true, false, $6) id", [loja, corte, prof, slots[0].slot_inicio, fone, chave]))
  return r.id
}
const cancelar = (cliente: string, id: string) => as(cliente, () => sql("select cancel_booking($1)", [id]))
/** O outbox-worker envia a cada minuto: marca como enviado o que estava na fila. */
const enviarFila = () => sql("update outbox_events set status = 'enviado' where status = 'pendente'")
const avisosAtivos = async (fone: string) =>
  Number((await sql(
    "select count(*) n from outbox_events where canal = 'whatsapp' and status <> 'cancelado' and tipo like 'reserva_%' and private.br_phone_key(destino) = private.br_phone_key($1)",
    [fone],
  ))[0].n)
const avisosDa = (reserva: string) => sql("select tipo, status, ultimo_erro from outbox_events where booking_id = $1 and canal = 'whatsapp' order by tipo", [reserva])

beforeAll(async () => {
  await db.exec(AMBIENTE)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  const semana = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))
  lojaA = (await as(ID.donoA, () => sql("select create_barbershop('Barbearia A', 'barbearia-a') id")))[0].id
  lojaB = (await as(ID.donoB, () => sql("select create_barbershop('Barbearia B', 'barbearia-b') id")))[0].id
  await sql("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'barbeiro')", [lojaA, ID.barbA])
  corteA = (await as(ID.donoA, () => sql("insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [lojaA])))[0].id
  corteB = (await as(ID.donoB, () => sql("insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [lojaB])))[0].id
  anaA = (await as(ID.donoA, () => sql("select save_professional($1, null, 'Ana', true, $2) id", [lojaA, [corteA]])))[0].id
  beaB = (await as(ID.donoB, () => sql("select save_professional($1, null, 'Bea', true, $2) id", [lojaB, [corteB]])))[0].id
  await as(ID.donoA, () => sql("select save_working_hours($1, $2)", [anaA, semana]))
  await as(ID.donoB, () => sql("select save_working_hours($1, $2)", [beaB, semana]))
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("limite por conta (create_booking)", () => {
  it("10 reservas em 24 h somando barbearias (canceladas contam); a 11ª é recusada e a repetição da mesma chave não conta", async () => {
    let ultima = ""
    for (let i = 0; i < 10; i++) {
      ultima = await reservar(i % 2 ? lojaB : lojaA, ID.atac1, "(11) 97777-0001", `atac1-${i}`)
      await cancelar(ID.atac1, ultima)
    }
    await expect(reservar(lojaA, ID.atac1, "(11) 97777-0001")).rejects.toThrow(/booking_rate_limited/)
    // repetição do mesmo pedido (idempotência) devolve a reserva já criada, sem esbarrar no limite
    expect(await reservar(lojaB, ID.atac1, "(11) 97777-0001", "atac1-9")).toBe(ultima)
  })

  it("o limite de uma conta não afeta outra conta", async () => {
    expect(await reservar(lojaA, ID.joao, "(21) 98888-0002")).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("a equipe não tem o limite na própria barbearia, mas tem nas outras", async () => {
    for (let i = 0; i < 10; i++) await cancelar(ID.barbA, await reservar(lojaA, ID.barbA, "(31) 96666-0003"))
    expect(await reservar(lojaA, ID.barbA, "(31) 96666-0003")).toMatch(/^[0-9a-f-]{36}$/)
    await expect(reservar(lojaB, ID.barbA, "(31) 96666-0003")).rejects.toThrow(/booking_rate_limited/)
  })
})

describe("teto de avisos de reserva por telefone", () => {
  const vitima = ["(64) 99275-0733", "+55 64 99275-0733", "0 64 9275-0733", "64992750733"]

  it("formatos diferentes do mesmo número dão a mesma chave", async () => {
    const chaves = await sql("select distinct private.br_phone_key(x) k from unnest($1::text[]) x", [vitima])
    expect(chaves).toHaveLength(1)
  })

  it("criar e cancelar com o número de outra pessoa para em 8 avisos em 24 h, em qualquer formato e com várias contas", async () => {
    const r1 = await reservar(lojaA, ID.atac2, vitima[0]); await enviarFila() // criada + confirmada = 2
    await cancelar(ID.atac2, r1); await enviarFila() // + cancelada = 3
    const r2 = await reservar(lojaB, ID.atac2, vitima[1]); await enviarFila() // 5
    await cancelar(ID.atac2, r2); await enviarFila() // 6
    const r3 = await reservar(lojaA, ID.atac3, vitima[2]); await enviarFila() // 8
    await cancelar(ID.atac3, r3)
    expect(await avisosAtivos(vitima[3])).toBe(8)
    expect((await avisosDa(r3)).find((a) => a.tipo === "reserva_cancelada")).toMatchObject({ status: "cancelado", ultimo_erro: "limite_telefone" })
  })

  it("terceiros não impedem a dona do número de reservar: a reserva vale e só o aviso fica retido", async () => {
    const r = await reservar(lojaB, ID.maria, vitima[3])
    expect((await sql("select status from bookings where id = $1", [r]))[0].status).toBe("confirmado")
    const avisos = await avisosDa(r)
    expect(avisos.length).toBeGreaterThan(0)
    for (const a of avisos) expect(a).toMatchObject({ status: "cancelado", ultimo_erro: "limite_telefone" })
    expect(await avisosAtivos(vitima[3])).toBe(8)
  })

  it("ação da equipe (reagendar/confirmar) não entra no teto: o aviso sai mesmo com o número no limite", async () => {
    const r = (await sql("select id from bookings where customer_id = $1", [ID.maria]))[0].id
    await sql("insert into booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes) values ($1, $2, $3, 'rescheduled', '{}')", [r, lojaB, ID.donoB])
    expect((await avisosDa(r)).find((a) => a.tipo === "reserva_reagendada")).toMatchObject({ status: "pendente", ultimo_erro: null })
  })

  it("outros números seguem recebendo avisos normalmente", async () => {
    const r = await reservar(lojaA, ID.joao, "(21) 98888-0002")
    for (const a of await avisosDa(r)) expect(a.status).toBe("pendente")
  })
})
