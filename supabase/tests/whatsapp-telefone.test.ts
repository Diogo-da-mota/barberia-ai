/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Tarefa A2 (DIAGNOSTICO_WHATSAPP_N8N.md, migration 0015): chave de telefone brasileira e bloqueio (PARAR) por barbearia.
// PostgreSQL local (PGlite), com os privilégios padrão do Supabase. Nada aqui toca o banco remoto.
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const MIGRATION = "supabase/migrations/0015_whatsapp_telefone.sql"
const APLICAR = "supabase/aplicar/0015.sql"

const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { donoA: U("a1"), donoB: U("b1"), barbA: U("c1"), cli1: U("d1"), cli2: U("d2"), cli3: U("d3") }

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

/** `ate` limita as migrations: "0014" reproduz produção antes desta tarefa. */
async function banco(ate?: string): Promise<PGlite> {
  const novo = new PGlite({ extensions: { btree_gist } })
  await novo.exec(AMBIENTE)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql")).sort()) {
    if (ate && f.slice(0, 4) > ate) continue
    await novo.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  }
  return novo
}

let db: PGlite
let lojaA = "", lojaB = "", corteA = "", corteB = "", anaA = "", beaB = ""
let seq = 0

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
const sql = async (q: string, p: unknown[] = []) => (await db.query<Record<string, any>>(q, p)).rows
const svc = (q: string, p: unknown[] = []) => as("service_role", null, () => sql(q, p))
const usuario = (user: string, q: string, p: unknown[] = []) => as("authenticated", user, () => sql(q, p))
const anonimo = (q: string, p: unknown[] = []) => as("anon", null, () => sql(q, p))

const chave = async (texto: string | null) => (await sql("select private.br_phone_key($1) k", [texto]))[0].k as string | null
const responder = async (from: string, contexto: string | null, texto: string) => {
  seq += 1
  const evento = `evt-${seq}`
  const [r] = await svc("select process_whatsapp_reply($1, now(), $2, $3, $4) r", [evento, from, contexto, texto])
  return { retorno: r.r as string, evento }
}
const inbound = async (evento: string) => (await sql("select status, motivo, barbershop_id from inbound_webhook_events where event_id = $1", [evento]))[0]
// ordenado pelo rótulo: os ids das barbearias são aleatórios e não definem uma ordem estável entre A e B
const bloqueios = async () => (await sql("select barbershop_id, telefone from phone_blocklist")).map((r) => `${r.barbershop_id === lojaA ? "A" : r.barbershop_id === lojaB ? "B" : "?"}:${r.telefone}`).sort()

async function evento(loja: string, destino: string, extra: { status?: string; canal?: string } = {}): Promise<string> {
  seq += 1
  const [r] = await sql(
    "insert into outbox_events (barbershop_id, tipo, canal, destino, dedup_key, status) values ($1, 'reserva_criada', $2, $3, $4, $5) returning id",
    [loja, extra.canal ?? "whatsapp", destino, `teste:${seq}`, extra.status ?? "pendente"],
  )
  return r.id
}
/** Registra que a mensagem saiu, como o worker faria. `quando` fixa a ordem entre envios. */
async function enviada(loja: string, destino: string, wamid: string, quando?: string): Promise<string> {
  const id = await evento(loja, destino, { status: "enviando" })
  await svc("select complete_outbox($1, true, $2, null)", [id, wamid])
  if (quando) await sql("update notification_logs set criado_em = $1::timestamptz where outbox_id = $2", [quando, id])
  return id
}
const estado = async (id: string) => (await sql("select status, ultimo_erro from outbox_events where id = $1", [id]))[0]
const reivindicar = async () => (await svc("select id from claim_outbox(200)")).map((r) => r.id as string)

async function reservar(loja: string, cliente: string, fone: string, marketing = false): Promise<string> {
  const [corte, prof] = loja === lojaA ? [corteA, anaA] : [corteB, beaB]
  const dia = (await anonimo("select ((now() at time zone 'America/Sao_Paulo')::date + 2)::text d"))[0].d
  const slots = await anonimo("select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, prof, dia])
  const [r] = await usuario(cliente, "select create_booking($1, $2, $3, $4, 'Cliente', $5, true, $6, null) id", [loja, corte, prof, slots[0].slot_inicio, fone, marketing])
  return r.id
}

beforeAll(async () => {
  db = await banco()
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  const semana = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))
  lojaA = (await usuario(ID.donoA, "select create_barbershop('Barbearia A', 'barbearia-a') id"))[0].id
  lojaB = (await usuario(ID.donoB, "select create_barbershop('Barbearia B', 'barbearia-b') id"))[0].id
  await sql("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'barbeiro')", [lojaA, ID.barbA])
  corteA = (await usuario(ID.donoA, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [lojaA]))[0].id
  corteB = (await usuario(ID.donoB, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [lojaB]))[0].id
  anaA = (await usuario(ID.donoA, "select save_professional($1, null, 'Ana', true, $2) id", [lojaA, [corteA]]))[0].id
  beaB = (await usuario(ID.donoB, "select save_professional($1, null, 'Bea', true, $2) id", [lojaB, [corteB]]))[0].id
  await usuario(ID.donoA, "select save_working_hours($1, $2)", [anaA, semana])
  await usuario(ID.donoB, "select save_working_hours($1, $2)", [beaB, semana])
  await svc("select set_integration_status($1, 'whatsapp', 'ativo')", [lojaA])
  await svc("select set_integration_status($1, 'whatsapp', 'ativo')", [lojaB])
}, 180_000)

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  await db.exec(`
    delete from phone_blocklist; delete from outbox_events; delete from inbound_webhook_events;
    delete from booking_events; delete from bookings; delete from occupancies; delete from consent_events; delete from customer_consents;
  `)
})

describe("private.br_phone_key: identidade do número", () => {
  it.each([
    ["11912345678", "1112345678"],
    ["+55 (11) 91234-5678", "1112345678"],
    ["5511912345678", "1112345678"],
    ["551112345678", "1112345678"],
    ["1112345678", "1112345678"],
    ["011912345678", "1112345678"],
    ["00 55 11 91234-5678", "1112345678"],
  ])("%s vira a chave do DDD 11", async (entrada, esperado) => {
    expect(await chave(entrada)).toBe(esperado)
  })

  it("DDDs diferentes geram chaves diferentes", async () => {
    expect(await chave("11988887777")).toBe("1188887777")
    expect(await chave("21988887777")).toBe("2188887777")
    expect(await chave("5521988887777")).toBe("2188887777")
  })

  it("o DDD 55 não é confundido com o código do país", async () => {
    expect(await chave("55912345678")).toBe("5512345678")
    expect(await chave("5555912345678")).toBe("5512345678")
    expect(await chave("555512345678")).toBe("5512345678")
  })

  it("telefone fixo mantém os 10 dígitos, com ou sem o país", async () => {
    expect(await chave("1132345678")).toBe("1132345678")
    expect(await chave("551132345678")).toBe("1132345678")
  })

  it("número estrangeiro continua identificável, sem colidir com número brasileiro", async () => {
    expect(await chave("+1 415 555 2671")).toBe("14155552671")
    expect(await chave("351912345678")).toBe("351912345678")
  })

  it.each([[null], [""], ["abc"], ["123"], ["1234567890123456"], ["000000000000"]])("entrada inválida (%s) não gera chave", async (entrada) => {
    expect(await chave(entrada)).toBeNull()
  })

  it("não é executável pela API", async () => {
    const [r] = await sql(`select has_function_privilege('anon', 'private.br_phone_key(text)', 'execute') anon,
      has_function_privilege('authenticated', 'private.br_phone_key(text)', 'execute') auth`)
    expect(r).toEqual({ anon: false, auth: false })
    await expect(usuario(ID.donoA, "select private.br_phone_key('11912345678')")).rejects.toThrow(/permission denied/)
  })
})

describe("colisão de DDD e nono dígito", () => {
  it("obrigatório: PARAR do DDD 11 não bloqueia o mesmo número no DDD 21", async () => {
    await enviada(lojaA, "11988887777", "wamid.ddd11")
    await responder("5511988887777", "wamid.ddd11", "PARAR")
    const ddd21 = await evento(lojaA, "21988887777")
    const ddd11 = await evento(lojaA, "11988887777")
    const entregues = await reivindicar()
    expect(entregues).toContain(ddd21)
    expect(entregues).not.toContain(ddd11)
    expect(await bloqueios()).toEqual(["A:1188887777"])
  })

  it("obrigatório: PARAR sem o nono dígito bloqueia o número cadastrado com ele", async () => {
    await enviada(lojaA, "31977776666", "wamid.nove1")
    const { retorno } = await responder("553177776666", "wamid.nove1", "PARAR")
    expect(retorno).toBe("processado")
    const id = await evento(lojaA, "31977776666")
    expect(await reivindicar()).not.toContain(id)
    expect(await estado(id)).toEqual({ status: "cancelado", ultimo_erro: "numero_bloqueado" })
  })

  it("obrigatório: PARAR com o nono dígito bloqueia o número cadastrado sem ele", async () => {
    await enviada(lojaA, "3177776666", "wamid.nove2")
    await responder("5531977776666", "wamid.nove2", "PARAR")
    const id = await evento(lojaA, "3177776666")
    expect(await reivindicar()).not.toContain(id)
  })

  it("obrigatório: resposta NÃO sem o nono dígito é reconhecida como o número da reserva", async () => {
    const r = await reservar(lojaA, ID.cli1, "31977776666")
    const [ev] = await sql("select id from outbox_events where booking_id = $1 and tipo = 'reserva_criada'", [r])
    await sql("update outbox_events set status = 'enviando' where id = $1", [ev.id])
    await svc("select complete_outbox($1, true, 'wamid.nao', null)", [ev.id])
    const { retorno, evento: e } = await responder("553177776666", "wamid.nao", "NAO")
    expect(retorno).toBe("processado")
    expect(await inbound(e)).toMatchObject({ status: "processado", motivo: "nao" })
    expect((await sql("select status from bookings where id = $1", [r]))[0].status).toBe("cancelado")
  })

  it("regressão: resposta de um número de outro DDD não confirma a reserva", async () => {
    const r = await reservar(lojaA, ID.cli1, "11988887777")
    const [ev] = await sql("select id from outbox_events where booking_id = $1 and tipo = 'reserva_criada'", [r])
    await sql("update outbox_events set status = 'enviando' where id = $1", [ev.id])
    await svc("select complete_outbox($1, true, 'wamid.outro', null)", [ev.id])
    const { retorno, evento: e } = await responder("5521988887777", "wamid.outro", "NAO")
    expect(retorno).toBe("ignorado")
    expect((await inbound(e)).motivo).toBe("telefone_divergente")
    expect((await sql("select status from bookings where id = $1", [r]))[0].status).toBe("confirmado")
  })

  it("número inválido continua sendo ignorado", async () => {
    const { retorno, evento: e } = await responder("123", null, "PARAR")
    expect(retorno).toBe("ignorado")
    expect((await inbound(e)).motivo).toBe("telefone_invalido")
  })
})

describe("PARAR por barbearia", () => {
  it("obrigatório: PARAR citando a mensagem da barbearia A bloqueia só a A; a B continua enviando", async () => {
    await enviada(lojaA, "11955554444", "wamid.a1", "2026-11-01T10:00:00Z")
    await enviada(lojaB, "11955554444", "wamid.b1", "2026-11-02T10:00:00Z")
    await responder("5511955554444", "wamid.a1", "PARAR")
    expect(await bloqueios()).toEqual(["A:1155554444"])

    const daA = await evento(lojaA, "11955554444")
    const daB = await evento(lojaB, "11955554444")
    const entregues = await reivindicar()
    expect(entregues).toEqual([daB])
    expect(await estado(daA)).toEqual({ status: "cancelado", ultimo_erro: "numero_bloqueado" })
    expect((await estado(daB)).status).toBe("enviando")
  })

  it("sem citar mensagem, vale a última barbearia que enviou para o número", async () => {
    await enviada(lojaA, "11955554444", "wamid.a2", "2026-11-01T10:00:00Z")
    await enviada(lojaB, "11955554444", "wamid.b2", "2026-11-02T10:00:00Z")
    await responder("5511955554444", null, "PARAR")
    expect(await bloqueios()).toEqual(["B:1155554444"])
  })

  it("sem envio anterior, vale a única barbearia com reserva desse número", async () => {
    await reservar(lojaB, ID.cli1, "11955554444")
    const { retorno, evento: e } = await responder("5511955554444", null, "PARAR")
    expect(retorno).toBe("processado")
    expect(await bloqueios()).toEqual(["B:1155554444"])
    expect((await inbound(e)).barbershop_id).toBe(lojaB)
  })

  it("sem envio e com reservas em duas barbearias, protege o titular nas duas, sem atribuir a resposta a nenhuma", async () => {
    await reservar(lojaA, ID.cli1, "11955554444")
    await reservar(lojaB, ID.cli1, "11955554444")
    const { evento: e } = await responder("5511955554444", null, "PARAR")
    expect(await bloqueios()).toEqual(["A:1155554444", "B:1155554444"])
    expect(await inbound(e)).toMatchObject({ status: "processado", motivo: "opt_out", barbershop_id: null })
  })

  it("número sem nenhum vínculo não gera bloqueio e fica registrado", async () => {
    const { retorno, evento: e } = await responder("5511944443333", null, "PARAR")
    expect(retorno).toBe("ignorado")
    expect((await inbound(e)).motivo).toBe("sem_barbearia")
    expect(await bloqueios()).toEqual([])
  })

  it("segurança: citar a mensagem de outro número não bloqueia nem atribui nada a esse número", async () => {
    await enviada(lojaA, "11955554444", "wamid.alheia")
    const { retorno } = await responder("5511933332222", "wamid.alheia", "PARAR")
    expect(retorno).toBe("ignorado")
    expect(await bloqueios()).toEqual([])
    expect(await reivindicar()).toEqual([])
    const vitima = await evento(lojaA, "11955554444")
    expect(await reivindicar()).toEqual([vitima])
  })

  it("segurança: evento do Google Calendar nunca define a barbearia do PARAR", async () => {
    const id = await evento(lojaA, "11955554444", { canal: "google_calendar", status: "enviando" })
    await svc("select complete_outbox($1, true, 'evento-google', null)", [id])
    const { retorno } = await responder("5511955554444", "evento-google", "PARAR")
    expect(retorno).toBe("ignorado")
    expect(await bloqueios()).toEqual([])
  })

  it("o opt-out de novidades vale só para a barbearia bloqueada", async () => {
    await reservar(lojaA, ID.cli1, "11955554444", true)
    await reservar(lojaB, ID.cli1, "11955554444", true)
    await enviada(lojaA, "11955554444", "wamid.a3")
    await responder("5511955554444", "wamid.a3", "PARAR")
    const consent = async (loja: string) => (await sql("select marketing from customer_consents where barbershop_id = $1 and profile_id = $2", [loja, ID.cli1]))[0].marketing
    expect(await consent(lojaA)).toBe(false)
    expect(await consent(lojaB)).toBe(true)
  })

  it("PARAR repetido em novo evento não falha nem duplica o bloqueio; o mesmo evento é duplicado", async () => {
    await enviada(lojaA, "11955554444", "wamid.a4")
    await responder("5511955554444", "wamid.a4", "PARAR")
    expect((await responder("5511955554444", "wamid.a4", "parar")).retorno).toBe("processado")
    expect(await bloqueios()).toEqual(["A:1155554444"])
    await svc("select process_whatsapp_reply('evt-fixo', now(), '5511955554444', 'wamid.a4', 'PARAR')")
    expect((await svc("select process_whatsapp_reply('evt-fixo', now(), '5511955554444', 'wamid.a4', 'PARAR') r"))[0].r).toBe("duplicado")
  })

  it("obrigatório: número bloqueado não recebe mensagem pendente, retida nem presa", async () => {
    await sql("insert into phone_blocklist (barbershop_id, telefone) values ($1, '1155554444')", [lojaA])
    const pendente = await evento(lojaA, "11955554444")
    const retido = await evento(lojaA, "5511955554444", { status: "bloqueado" })
    const semNove = await evento(lojaA, "551155554444")
    expect(await reivindicar()).toEqual([])
    for (const id of [pendente, retido, semNove]) expect(await estado(id)).toEqual({ status: "cancelado", ultimo_erro: "numero_bloqueado" })
  })

  it("o bloqueio não alcança evento do Google Calendar de destino com os mesmos dígitos", async () => {
    await svc("select set_integration_status($1, 'google_calendar', 'ativo')", [lojaA])
    await sql("insert into phone_blocklist (barbershop_id, telefone) values ($1, '1155554444')", [lojaA])
    const calendario = await evento(lojaA, "11955554444", { canal: "google_calendar" })
    expect(await reivindicar()).toEqual([calendario])
    await svc("select set_integration_status($1, 'google_calendar', 'nao_configurado')", [lojaA])
  })
})

describe("limite de 12 mensagens em 24h, por barbearia", () => {
  it("o volume da barbearia A não cancela a mensagem da barbearia B ao mesmo número", async () => {
    for (let i = 0; i < 12; i++) await evento(lojaA, "11966665555", { status: "enviado" })
    const daA = await evento(lojaA, "11966665555")
    const daB = await evento(lojaB, "11966665555")
    expect(await reivindicar()).toEqual([daB])
    expect(await estado(daA)).toEqual({ status: "cancelado", ultimo_erro: "limite_destino" })
  })

  it("número escrito com e sem o nono dígito soma no mesmo limite", async () => {
    for (let i = 0; i < 6; i++) await evento(lojaA, "11966665555", { status: "enviado" })
    for (let i = 0; i < 6; i++) await evento(lojaA, "551166665555", { status: "enviado" })
    const nova = await evento(lojaA, "11966665555")
    expect(await reivindicar()).toEqual([])
    expect(await estado(nova)).toEqual({ status: "cancelado", ultimo_erro: "limite_destino" })
  })

  it("números de DDDs diferentes não somam no mesmo limite", async () => {
    for (let i = 0; i < 12; i++) await evento(lojaA, "11966665555", { status: "enviado" })
    const outroDdd = await evento(lojaA, "21966665555")
    expect(await reivindicar()).toEqual([outroDdd])
  })
})

describe("isolamento e permissões", () => {
  const OPERACOES = [
    "select * from phone_blocklist",
    "insert into phone_blocklist (barbershop_id, telefone) values ('00000000-0000-4000-8000-000000000000', '1100000000')",
    "update phone_blocklist set telefone = '1100000000'",
    "delete from phone_blocklist",
  ]

  it("obrigatório: nenhum usuário lê ou altera bloqueios, nem da própria barbearia nem de outra", async () => {
    await sql("insert into phone_blocklist (barbershop_id, telefone) values ($1, '1155554444'), ($2, '1155554444')", [lojaA, lojaB])
    for (const quem of [ID.donoA, ID.donoB, ID.barbA, ID.cli1]) {
      for (const op of OPERACOES) await expect(usuario(quem, op), `${quem}: ${op}`).rejects.toThrow(/permission denied/)
    }
    for (const op of OPERACOES) await expect(anonimo(op), op).rejects.toThrow(/permission denied/)
    expect(await bloqueios()).toEqual(["A:1155554444", "B:1155554444"])
  })

  it("a tabela segue com RLS ligada e sem nenhuma política", async () => {
    expect((await sql("select relrowsecurity r from pg_class where oid = 'public.phone_blocklist'::regclass"))[0].r).toBe(true)
    expect((await sql("select count(*)::int n from pg_policies where tablename = 'phone_blocklist'"))[0].n).toBe(0)
  })

  it("o registro da resposta só é visto pela gestão da barbearia identificada", async () => {
    await enviada(lojaA, "11955554444", "wamid.rls")
    const { evento: e } = await responder("5511955554444", "wamid.rls", "PARAR")
    const ver = (quem: string) => usuario(quem, "select id from inbound_webhook_events where event_id = $1", [e])
    expect(await ver(ID.donoA)).toHaveLength(1)
    expect(await ver(ID.donoB)).toHaveLength(0)
    expect(await ver(ID.barbA)).toHaveLength(0)
    expect(await ver(ID.cli1)).toHaveLength(0)
  })

  it("a mesma chave pode existir em barbearias diferentes, mas não repetida na mesma", async () => {
    await sql("insert into phone_blocklist (barbershop_id, telefone) values ($1, '1155554444'), ($2, '1155554444')", [lojaA, lojaB])
    await expect(sql("insert into phone_blocklist (barbershop_id, telefone) values ($1, '1155554444')", [lojaA])).rejects.toThrow(/duplicate/)
  })

  it("bloqueio exige barbearia existente e chave de 10 a 15 dígitos", async () => {
    await expect(sql("insert into phone_blocklist (telefone) values ('1155554444')")).rejects.toThrow(/null/)
    await expect(sql("insert into phone_blocklist (barbershop_id, telefone) values ('00000000-0000-4000-8000-000000000000', '1155554444')")).rejects.toThrow(/foreign key/)
    await expect(sql("insert into phone_blocklist (barbershop_id, telefone) values ($1, '123')", [lojaA])).rejects.toThrow(/check/)
  })

  it("funções do worker e do webhook seguem só para service_role, com search_path fixo", async () => {
    for (const f of ["public.claim_outbox(integer)", "public.process_whatsapp_reply(text, timestamptz, text, text, text)"]) {
      const [r] = await sql(`select has_function_privilege('anon', $1::regprocedure, 'execute') anon, has_function_privilege('authenticated', $1::regprocedure, 'execute') auth,
        has_function_privilege('service_role', $1::regprocedure, 'execute') svc,
        (select proconfig::text like '%search_path%' from pg_proc where oid = $1::regprocedure) caminho,
        (select prosecdef from pg_proc where oid = $1::regprocedure) definer`, [f])
      expect(r, f).toEqual({ anon: false, auth: false, svc: true, caminho: true, definer: true })
    }
  })

  it("nenhuma função usa mais a chave antiga de 10 dígitos à direita", async () => {
    const r = await sql(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosrc ~ 'right\\(.*10\\)'`)
    expect(r).toEqual([])
  })
})

describe("aplicação sobre o estado atual de produção (migrations até 0014)", () => {
  let producao: PGlite
  const naProducao = async (q: string, p: unknown[] = []) => (await producao.query<Record<string, any>>(q, p)).rows

  beforeAll(async () => {
    producao = await banco("0014")
    await producao.query("insert into auth.users (id, email) values ($1, 'dono@example.test')", [ID.donoA])
    await producao.query("select set_config('request.jwt.claim.sub', $1, false)", [ID.donoA])
    await producao.exec("set role authenticated")
    await producao.exec("select create_barbershop('Barbearia P', 'barbearia-p'); select create_barbershop('Barbearia Q', 'barbearia-q')")
    await producao.exec("reset role")
  }, 180_000)

  afterAll(async () => {
    await producao.close()
  })

  it("o arquivo de aplicação contém exatamente a migration, em uma transação", () => {
    const aplicar = readFileSync(APLICAR, "utf8")
    expect(aplicar).toContain(readFileSync(MIGRATION, "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*?\nbegin;\n[\s\S]*\ncommit;\s*$/)
  })

  it("bloqueio antigo sem barbearia identificável interrompe tudo, sem perder nem alterar nada", async () => {
    await naProducao("insert into phone_blocklist (telefone) values ('9999999999')")
    const antes = await naProducao("select column_name from information_schema.columns where table_name = 'phone_blocklist' order by 1")

    await expect(producao.exec(readFileSync(APLICAR, "utf8"))).rejects.toThrow(/phone_blocklist_sem_barbearia/)
    await producao.exec("rollback")

    expect(await naProducao("select column_name from information_schema.columns where table_name = 'phone_blocklist' order by 1")).toEqual(antes)
    expect((await naProducao("select telefone from phone_blocklist")).map((r) => r.telefone)).toEqual(["9999999999"])
    expect((await naProducao("select to_regprocedure('private.br_phone_key(text)') f"))[0].f).toBeNull()
    await naProducao("delete from phone_blocklist")
  })

  it("converte bloqueios antigos para cada barbearia e chave, preserva a data e não toca na fila", async () => {
    const [p, q] = (await naProducao("select id from barbershops order by nome")).map((r) => r.id as string)
    const inserir = (loja: string, destino: string, dedup: string) =>
      naProducao("insert into outbox_events (barbershop_id, tipo, destino, dedup_key, status) values ($1, 'reserva_criada', $2, $3, 'pendente')", [loja, destino, dedup])
    await inserir(p, "11912345678", "m1")
    await inserir(q, "11912345678", "m2")
    await inserir(p, "21912345678", "m3") // mesma chave antiga: as duas pessoas estavam bloqueadas e continuam
    await naProducao("insert into phone_blocklist (telefone, criado_em) values ('1912345678', '2026-01-02T03:04:05Z')")
    const fila = await naProducao("select id, status, ultimo_erro, atualizado_em from outbox_events order by id")

    await producao.exec(readFileSync(APLICAR, "utf8"))

    const convertidos = await naProducao("select barbershop_id, telefone, criado_em from phone_blocklist order by telefone, barbershop_id")
    expect(convertidos.map((r) => [r.barbershop_id === p ? "P" : "Q", r.telefone]).sort()).toEqual([["P", "1112345678"], ["P", "2112345678"], ["Q", "1112345678"]])
    for (const r of convertidos) expect(new Date(r.criado_em).toISOString()).toBe("2026-01-02T03:04:05.000Z")
    expect(await naProducao("select id, status, ultimo_erro, atualizado_em from outbox_events order by id")).toEqual(fila)
  })

  it("depois de aplicar, anônimo e autenticado seguem sem acesso à tabela, mesmo com o privilégio padrão do Supabase", async () => {
    for (const papel of ["anon", "authenticated"]) {
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        const [r] = await naProducao("select has_table_privilege($1, 'public.phone_blocklist', $2) ok", [papel, priv])
        expect(r.ok, `${papel} ${priv}`).toBe(false)
      }
    }
  })
})
