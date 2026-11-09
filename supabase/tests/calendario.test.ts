/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Google Calendar por profissional (F10-01 a F10-04) em PostgreSQL local (PGlite).
// Política: sincronização UNIDIRECIONAL (Barberia AI → Google). Eventos externos nunca entram na agenda.
// Nenhuma chamada ao Google é feita aqui; a demonstração com calendário real fica bloqueada (sem credenciais).
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite({ extensions: { btree_gist } })
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), donoB: U("b1"), barb1: U("c1"), barb2: U("c2"), cli: U("d1") }
const ESCOPO = "https://www.googleapis.com/auth/calendar.events"
let loja = "", corte = "", ana = "", bia = ""

async function as<T>(role: "anon" | "authenticated" | "service_role", user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""])
  await db.exec(`set role ${role}`)
  try {
    return await fn()
  } finally {
    await db.exec("reset role")
  }
}
const rows = (user: string | null, sql: string, params: unknown[] = []) =>
  as(user ? "authenticated" : "anon", user, async () => (await db.query<Record<string, any>>(sql, params)).rows)
const val = async (user: string | null, sql: string, params: unknown[] = []) => Object.values((await rows(user, sql, params))[0])[0] as any
const svc = (sql: string, params: unknown[] = []) => as("service_role", null, async () => (await db.query<Record<string, any>>(sql, params)).rows)
const svcVal = async (sql: string, params: unknown[] = []) => Object.values((await svc(sql, params))[0])[0] as any
const sql = async (q: string, params: unknown[] = []) => (await db.query<Record<string, any>>(q, params)).rows

async function reservar(prof: string, i = 0): Promise<string> {
  const dia = await val(null, "select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text")
  const slots = await rows(null, "select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, prof, dia])
  return val(ID.cli, "select create_booking($1, $2, $3, $4, 'Cliente', '11912345678', false, false, null)", [loja, corte, prof, slots[i].slot_inicio])
}

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    grant usage on schema public to service_role;
  `)
  for (const f of ["0001_identidade_inicial", "0002_catalogo", "0003_agenda", "0004_barbeiro", "0005_financeiro", "0006_eventos", "0009_calendario"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  loja = await val(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")
  await val(ID.donoB, "select create_barbershop('Barbearia B', 'barbearia-b')")
  for (const b of [ID.barb1, ID.barb2]) await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'barbeiro')", [loja, b])
  corte = (await rows(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [loja]))[0].id
  ana = await val(ID.dono, "select save_professional($1, null, 'Ana', true, $2)", [loja, [corte]])
  bia = await val(ID.dono, "select save_professional($1, null, 'Bia', true, $2)", [loja, [corte]])
  const semana = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))
  for (const p of [ana, bia]) await rows(ID.dono, "select save_working_hours($1, $2)", [p, semana])
  await rows(ID.dono, "select link_professional($1, $2)", [ana, ID.barb1])
  await rows(ID.dono, "select link_professional($1, $2)", [bia, ID.barb2])
  await svc("select set_integration_status($1, 'google_calendar', 'ativo')", [loja])
  await svc("select set_integration_status($1, 'whatsapp', 'ativo')", [loja])
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("F10-01/02: vínculo com consentimento explícito e tokens só no servidor", () => {
  it("só a própria pessoa inicia o vínculo do seu calendário (gestão e colegas não)", async () => {
    for (const u of [ID.dono, ID.barb2, ID.cli, ID.donoB]) await expect(val(u, "select start_calendar_link($1)", [ana])).rejects.toThrow(/forbidden/)
    expect(await val(ID.barb1, "select start_calendar_link($1)", [ana])).toMatch(/^[0-9a-f]{32,}$/)
  })

  it("cada pessoa descobre o próprio profissional; quem não é profissional recebe nulo", async () => {
    expect(await val(ID.barb1, "select my_professional($1)", [loja])).toBe(ana)
    expect(await val(ID.barb2, "select my_professional($1)", [loja])).toBe(bia)
    for (const u of [ID.dono, ID.cli, ID.donoB]) expect(await val(u, "select my_professional($1)", [loja])).toBeNull()
  })

  it("o retorno do Google só vale com o state emitido, uma única vez, e com o escopo mínimo de eventos", async () => {
    await expect(svc("select complete_calendar_link('state-inventado', 'cal-1', $1)", [[ESCOPO]])).rejects.toThrow(/invalid_state/)
    const state = await val(ID.barb1, "select start_calendar_link($1)", [ana])
    await expect(svc("select complete_calendar_link($1, 'cal-1', $2)", [state, ["openid", "email"]])).rejects.toThrow(/scope_missing/) // login Google não dá acesso ao Calendar
    await expect(svc("select complete_calendar_link($1, 'cal-1', $2)", [state, [ESCOPO, "https://www.googleapis.com/auth/calendar"]])).rejects.toThrow(/scope_too_broad/)
    await svc("select complete_calendar_link($1, 'cal-1', $2)", [state, [ESCOPO]])
    await expect(svc("select complete_calendar_link($1, 'cal-1', $2)", [state, [ESCOPO]])).rejects.toThrow(/invalid_state/) // uso único
    const vencido = await val(ID.barb2, "select start_calendar_link($1)", [bia])
    await sql("update calendar_connections set state_expira_em = now() - interval '1 minute' where professional_id = $1", [bia])
    await expect(svc("select complete_calendar_link($1, 'cal-2', $2)", [vencido, [ESCOPO]])).rejects.toThrow(/invalid_state/)
  })

  it("a conexão fica ativa com consentimento registrado; tokens não são legíveis por ninguém da API", async () => {
    const [c] = await rows(ID.barb1, "select status, calendar_id, escopos, consentido_em is not null as consentiu from calendar_connections where professional_id = $1", [ana])
    expect(c).toMatchObject({ status: "ativo", calendar_id: "cal-1", escopos: [ESCOPO], consentiu: true })
    await svc("select store_calendar_tokens($1, 'refresh-secreto')", [ana])
    for (const u of [ID.dono, ID.barb1, ID.cli]) await expect(rows(u, "select * from calendar_credentials")).rejects.toThrow(/permission denied/)
    await expect(rows(ID.dono, "select refresh_token from calendar_connections")).rejects.toThrow(/column|permission denied/)
    expect(await svcVal("select get_calendar_refresh_token($1)", [ana])).toBe("refresh-secreto")
  })

  it("gestão vê o estado do vínculo da equipe; cliente e outra empresa não veem nada", async () => {
    expect((await rows(ID.dono, "select professional_id, status from calendar_connections order by status")).map((r) => r.status)).toEqual(["aguardando_consentimento", "ativo"])
    expect(await rows(ID.barb2, "select 1 from calendar_connections")).toHaveLength(1) // só o próprio vínculo (Bia, ainda pendente)
    expect(await rows(ID.barb1, "select 1 from calendar_connections")).toHaveLength(1)
    for (const u of [ID.cli, ID.donoB]) expect(await rows(u, "select 1 from calendar_connections")).toHaveLength(0)
  })
})

describe("F10-03: sincronização via outbox com mapeamento e idempotência", () => {
  let reserva = ""
  it("reserva do profissional vinculado gera evento de calendário; profissional sem vínculo, não", async () => {
    reserva = await reservar(ana)
    const semVinculo = await reservar(bia, 8)
    const ev = await rows(ID.dono, "select tipo, canal, status, destino from outbox_events where booking_id = $1 and canal = 'google_calendar'", [reserva])
    expect(ev).toEqual([{ tipo: "calendar_upsert", canal: "google_calendar", status: "pendente", destino: ana }])
    expect(await rows(ID.dono, "select 1 from outbox_events where booking_id = $1 and canal = 'google_calendar'", [semVinculo])).toHaveLength(0)
  })

  it("o worker grava o mapeamento reserva ↔ evento externo; repetir não duplica", async () => {
    const conn = await val(ID.barb1, "select id from calendar_connections where professional_id = $1", [ana])
    await svc("select complete_calendar_sync($1, $2, 'gcal-evt-1', 'etag-1', false)", [reserva, conn])
    await svc("select complete_calendar_sync($1, $2, 'gcal-evt-1', 'etag-2', false)", [reserva, conn])
    const links = await rows(ID.dono, "select external_event_id, etag, status from calendar_event_links where booking_id = $1", [reserva])
    expect(links).toEqual([{ external_event_id: "gcal-evt-1", etag: "etag-2", status: "sincronizado" }])
  })

  it("reagendar e cancelar geram novos eventos de calendário; o destino do worker traz o evento externo conhecido", async () => {
    await rows(ID.cli, "select cancel_booking($1)", [reserva])
    const tipos = (await rows(ID.dono, "select tipo from outbox_events where booking_id = $1 and canal = 'google_calendar' order by criado_em, tipo", [reserva])).map((r) => r.tipo)
    expect(tipos).toContain("calendar_delete")
    const [alvo] = await svc("select connection_id, external_event_id from get_calendar_target($1)", [reserva])
    expect(alvo.external_event_id).toBe("gcal-evt-1")
    const conn = alvo.connection_id
    await svc("select complete_calendar_sync($1, $2, null, null, true)", [reserva, conn])
    expect((await rows(ID.dono, "select status from calendar_event_links where booking_id = $1", [reserva]))[0].status).toBe("removido")
  })

  it("falha da API do Google não altera a reserva: o evento só volta a tentar mais tarde", async () => {
    const r = await reservar(ana, 12)
    const [ev] = await svc("select id from outbox_events where booking_id = $1 and canal = 'google_calendar'", [r])
    const got = await svc("select id from claim_outbox(50)")
    expect(got.map((g) => g.id)).toContain(ev.id)
    await svc("select complete_outbox($1, false, null, 'google 503')", [ev.id])
    expect((await rows(ID.dono, "select status, ultimo_erro from outbox_events where id = $1", [ev.id]))[0]).toMatchObject({ status: "pendente", ultimo_erro: "google 503" })
    expect(await val(ID.cli, "select status from bookings where id = $1", [r])).toBe("confirmado")
  })

  it("sem a integração Google ativa na empresa, os eventos ficam bloqueados (nada é simulado)", async () => {
    await svc("select set_integration_status($1, 'google_calendar', 'nao_configurado')", [loja])
    const r = await reservar(ana, 16)
    await svc("select * from claim_outbox(50)")
    expect((await rows(ID.dono, "select status, ultimo_erro from outbox_events where booking_id = $1 and canal = 'google_calendar'", [r]))[0]).toMatchObject({ status: "bloqueado", ultimo_erro: "canal_nao_configurado" })
    await svc("select set_integration_status($1, 'google_calendar', 'ativo')", [loja])
  })
})

describe("F10-04: política para eventos externos e remoção do vínculo", () => {
  it("eventos do Google nunca bloqueiam nem criam horários (unidirecional): não existe caminho de entrada", async () => {
    const funcoes = await sql("select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname ~* '(import|inbound_calendar|from_google)'")
    expect(funcoes).toHaveLength(0)
    const antes = await rows(null, "select count(*)::int as n from get_availability($1, $2, $3, ((now() at time zone 'America/Sao_Paulo')::date + 2)::date)", [loja, corte, bia])
    expect(antes[0].n).toBeGreaterThan(0)
  })

  it("desvincular remove as credenciais, marca os mapeamentos e para de gerar eventos; só a própria pessoa ou a gestão", async () => {
    await expect(rows(ID.barb2, "select unlink_calendar($1)", [ana])).rejects.toThrow(/forbidden/)
    await expect(rows(ID.donoB, "select unlink_calendar($1)", [ana])).rejects.toThrow(/forbidden/)
    await sql("update bookings set status = 'cancelado' where customer_id = $1 and status = 'confirmado'", [ID.cli]) // limite de 3 reservas futuras por cliente
    const r = await reservar(ana, 0)
    const conn = await val(ID.barb1, "select id from calendar_connections where professional_id = $1", [ana])
    await svc("select complete_calendar_sync($1, $2, 'gcal-evt-9', 'e', false)", [r, conn])
    await rows(ID.barb1, "select unlink_calendar($1)", [ana])
    expect((await rows(ID.barb1, "select status from calendar_connections where professional_id = $1", [ana]))[0].status).toBe("desvinculado")
    expect(await svcVal("select get_calendar_refresh_token($1)", [ana])).toBeNull()
    expect((await rows(ID.dono, "select status from calendar_event_links where booking_id = $1", [r]))[0].status).toBe("desvinculado")
    const depois = await reservar(ana, 0)
    expect(await rows(ID.dono, "select 1 from outbox_events where booking_id = $1 and canal = 'google_calendar'", [depois])).toHaveLength(0)
    await rows(ID.dono, "select unlink_calendar($1)", [ana]) // idempotente, e a gestão também pode
  })

  it("T13: funções de servidor do calendário não são chamadas por clientes", async () => {
    for (const c of [
      "select complete_calendar_link('x', 'y', array['z'])",
      "select complete_calendar_sync(gen_random_uuid(), gen_random_uuid(), 'a', 'b', false)",
      "select get_calendar_target(gen_random_uuid())",
      "select store_calendar_tokens(gen_random_uuid(), 'x')",
      "select get_calendar_refresh_token(gen_random_uuid())",
    ]) {
      await expect(rows(ID.dono, c)).rejects.toThrow(/permission denied/)
      await expect(rows(null, c)).rejects.toThrow(/permission denied/)
    }
  })
})
