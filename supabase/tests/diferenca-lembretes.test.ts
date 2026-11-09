/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// supabase/aplicar/diferenca-lembretes.sql alinha a fila de confirmação e lembretes de produção à 0017 do repositório.
// Reproduz em PGlite o estado lido do remoto em 2026-11-07: migrations até a 0016, a coluna reminder_config e o
// save_site_profile da 0017, e o schedule_reminders de rascunho (fixture). Nada aqui toca o banco remoto.
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const SCRIPT = "supabase/aplicar/diferenca-lembretes.sql"
const FIXTURE = "supabase/tests/fixtures/remoto-schedule_reminders.sql"
const MIGRATION_0017 = "supabase/migrations/0017_reminder_config.sql"

const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), cli1: U("d1") }

// Mesmo ambiente do Supabase usado em diferenca-whatsapp.test.ts
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

async function banco(ate: string): Promise<PGlite> {
  const db = new PGlite({ extensions: { btree_gist } })
  await db.exec(AMBIENTE)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql") && x.slice(0, 4) <= ate).sort()) {
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  }
  return db
}

/** Funções e privilégios de execução em public/private: o que o script pode mudar. */
const FUNCOES = `select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' k,
    jsonb_build_object('src', regexp_replace(p.prosrc,'\\s+',' ','g'),'secdef',p.prosecdef,'cfg',p.proconfig,'vol',p.provolatile,
      'anon',has_function_privilege('anon',p.oid,'execute'),'auth',has_function_privilege('authenticated',p.oid,'execute'),'svc',has_function_privilege('service_role',p.oid,'execute')) v
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') order by 1`
async function funcoes(db: PGlite): Promise<Record<string, unknown>> {
  return Object.fromEntries((await db.query<{ k: string; v: unknown }>(FUNCOES)).rows.map((r) => [r.k, r.v]))
}
function diferencas(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort()
}

let db: PGlite
let referencia: PGlite
let loja = "", corte = "", ana = ""
let numero = 0

async function as<T>(role: "authenticated" | "service_role", user: string | null, fn: () => Promise<T>): Promise<T> {
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
const autenticado = (q: string, p: unknown[] = [], user: string = ID.dono) => as("authenticated", user, () => sql(q, p))
const configurar = (lead: number, autoConfirmation = true) =>
  sql("update barbershops set reminder_config = jsonb_build_object('auto_confirmation', $3::boolean, 'auto_reminder', true, 'lead_time_minutes', $2::int) where id = $1", [loja, lead, autoConfirmation])
const antecedencia = (min: number) => configurar(min)
async function reservaEm(minutos: number): Promise<string> {
  await sql("update bookings set status = 'cancelado' where status in ('pendente', 'confirmado')")
  await sql("delete from occupancies")
  const dia = (await sql("select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text d"))[0].d
  const [slot] = await sql("select slot_inicio from get_availability($1, $2, $3, $4) order by 1 limit 1", [loja, corte, ana, dia])
  const [r] = await autenticado("select create_booking($1, $2, $3, $4, 'Cliente', $5, true, false, null) id",
    [loja, corte, ana, slot.slot_inicio, `(11) 9${2000 + ++numero}-5678`], ID.cli1)
  await sql("update bookings set inicio = now() + make_interval(mins => $2::int), fim = now() + make_interval(mins => $2::int + 40) where id = $1", [r.id, minutos])
  return r.id
}
const agendar = () => svc("select schedule_reminders()")
const lembretes = async (r: string) =>
  await sql("select id, tipo, status, ultimo_erro, dedup_key from outbox_events where booking_id = $1 and tipo like 'lembrete_%' order by criado_em", [r])
const reivindicar = async () => (await svc("select id from claim_outbox(200)")).map((g) => g.id as string)
const confirmacoes = async (r: string) => await sql("select id, status from outbox_events where booking_id = $1 and tipo = 'reserva_confirmada'", [r])
async function confirmar(r: string) {
  await sql("update bookings set status = 'pendente' where id = $1", [r])
  await autenticado("select set_booking_status($1, 'confirmado')", [r])
}
/** Retrato do histórico de uma linha: tudo menos a chave de deduplicação. */
const historico = async (id: string) =>
  (await sql("select status, tipo, payload, tentativas, ultimo_erro, criado_em, atualizado_em, proximo_envio, (select count(*) from notification_logs where outbox_id = $1) logs from outbox_events where id = $1", [id]))[0]

let duplicada = "", enviadoAntes = "", copiaNaFila = "", cancelado = ""
let historicoEnviado: unknown, chaveCancelado = "", historicoCancelado: unknown

beforeAll(async () => {
  referencia = await banco("0017")
  db = await banco("0016")
  // estado de produção em 2026-11-07: a parte da 0017 que já está lá (coluna e save_site_profile) + o agendador de rascunho
  const m17 = readFileSync(MIGRATION_0017, "utf8")
  await db.exec(m17.slice(0, m17.indexOf("--------------------------------------------------------------\n-- Janela do lembrete")))
  await db.exec(readFileSync(FIXTURE, "utf8"))

  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  loja = (await autenticado("select create_barbershop('Barbearia A', 'barbearia-a') id"))[0].id
  corte = (await autenticado("insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [loja]))[0].id
  ana = (await autenticado("select save_professional($1, null, 'Ana', true, $2) id", [loja, [corte]]))[0].id
  const semana = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))
  await autenticado("select save_working_hours($1, $2)", [ana, semana])
  await svc("select set_integration_status($1, 'whatsapp', 'ativo')", [loja])
}, 180_000)

afterAll(async () => {
  await db.close()
  await referencia.close()
})

describe("estado de produção reproduzido, antes do script", () => {
  it("com 15 min de antecedência o rascunho nunca gera o lembrete (faltam 14 min)", async () => {
    await antecedencia(15)
    const r = await reservaEm(14)
    await agendar()
    expect(await lembretes(r)).toHaveLength(0)
  })

  it("com 30 min o rascunho fecha a janela 15 min antes do início: faltando 10, não gera", async () => {
    await antecedencia(30)
    const r = await reservaEm(10)
    await agendar()
    expect(await lembretes(r)).toHaveLength(0)
  })

  it("com auto_confirmation desligada, o gatilho de produção (0009) ainda enfileira a confirmação", async () => {
    await configurar(30, false)
    const r = await reservaEm(180)
    await confirmar(r)
    expect(await confirmacoes(r)).toHaveLength(1)
    await configurar(30, true)
  })

  it("trocar a antecedência (60 → 30) duplica o lembrete da mesma reserva", async () => {
    await antecedencia(60)
    duplicada = await reservaEm(25)
    await agendar()
    const [primeiro] = await lembretes(duplicada)
    expect(await reivindicar()).toContain(primeiro.id)
    await svc("select complete_outbox($1, true, 'wamid.x', null)", [primeiro.id])
    await antecedencia(30)
    await agendar()
    const todos = await lembretes(duplicada)
    expect(todos.map((l) => l.tipo)).toEqual(["lembrete_60min", "lembrete_30min"])
    enviadoAntes = primeiro.id
    copiaNaFila = todos[1].id
    historicoEnviado = await historico(enviadoAntes)
  })

  it("prepara um lembrete do rascunho já cancelado (histórico que o script não pode tocar)", async () => {
    await antecedencia(60)
    const r = await reservaEm(50)
    await agendar()
    const [l] = await lembretes(r)
    await sql("update outbox_events set status = 'cancelado', ultimo_erro = 'reserva_cancelada' where id = $1", [l.id])
    cancelado = l.id
    chaveCancelado = l.dedup_key
    historicoCancelado = await historico(l.id)
  })

  it("só as funções da fila diferem do repositório", async () => {
    expect(diferencas(await funcoes(db), await funcoes(referencia))).toEqual([
      "private.enqueue_booking_event()",
      "private.lembrete_prazo(p_inicio timestamp with time zone, p_lead_min integer)",
      "private.lembrete_vencido(p_payload jsonb)",
      "public.claim_outbox(p_limit integer)",
      "public.release_blocked_outbox(p_barbershop_id uuid)",
      "public.schedule_reminders()",
    ])
  })
})

describe("depois do script", () => {
  beforeAll(async () => {
    await db.exec(readFileSync(SCRIPT, "utf8"))
  })

  it("as funções ficam iguais às do repositório (0017)", async () => {
    expect(diferencas(await funcoes(db), await funcoes(referencia))).toEqual([])
  })

  it("a cópia gravada pelo rascunho sai da fila e a enviada assume a chave nova: nada é reenviado", async () => {
    expect(await historico(enviadoAntes)).toEqual(historicoEnviado) // só a chave mudou: status, payload, datas e logs intactos
    expect(await historico(cancelado)).toEqual(historicoCancelado)
    expect((await sql("select dedup_key from outbox_events where id = $1", [cancelado]))[0].dedup_key).toBe(chaveCancelado)
    const todos = await lembretes(duplicada)
    expect(todos.find((l) => l.id === enviadoAntes)).toMatchObject({ status: "enviado", dedup_key: `${duplicada}:lembrete:${todos[0].dedup_key.split(":")[2]}` })
    expect(todos.find((l) => l.id === copiaNaFila)).toMatchObject({ status: "cancelado", ultimo_erro: "lembrete_duplicado" })
    // a reserva continua confirmada e na janela: o agendador novo a vê, e a chave migrada impede o segundo lembrete
    await sql("update bookings set status = 'cancelado' where status in ('pendente', 'confirmado')")
    await sql("update bookings set status = 'confirmado' where id = $1", [duplicada])
    await agendar()
    expect(await lembretes(duplicada)).toHaveLength(2)
    const enviados = await reivindicar()
    expect(enviados).not.toContain(enviadoAntes)
    expect(enviados).not.toContain(copiaNaFila)
  })

  it("15 min de antecedência volta a gerar (faltam 14) e trocar a antecedência não duplica", async () => {
    await antecedencia(15)
    const r = await reservaEm(14)
    await agendar()
    expect(await lembretes(r)).toHaveLength(1)
    for (const lead of [30, 60, 15]) {
      await antecedencia(lead)
      await agendar()
    }
    expect(await lembretes(r)).toHaveLength(1)
  })

  it("a janela é a mesma para 15, 30, 60 e 120 min: abre na antecedência e vai até o início", async () => {
    for (const lead of [15, 30, 60, 120]) {
      await antecedencia(lead)
      const antes = await reservaEm(lead + 1)
      await agendar()
      expect(await lembretes(antes), `${lead} min: antes de abrir`).toHaveLength(0)
      const fim = await reservaEm(1)
      await agendar()
      const [l] = await lembretes(fim)
      expect(l, `${lead} min: faltando 1 min`).toMatchObject({ tipo: `lembrete_${lead}min`, status: "pendente" })
      expect(await reivindicar(), `${lead} min`).toContain(l.id)
    }
  })

  it("confirmação: ligada enfileira exatamente uma (ao nascer confirmada), desligada enfileira zero", async () => {
    await configurar(30, true)
    const ligada = await reservaEm(180)
    expect(await confirmacoes(ligada)).toHaveLength(1) // nasceu confirmada: exatamente uma
    await confirmar(ligada)
    expect(await confirmacoes(ligada)).toHaveLength(1) // sem segunda confirmação para a mesma reserva
    await configurar(30, false)
    const desligada = await reservaEm(180)
    await confirmar(desligada)
    expect(await confirmacoes(desligada)).toHaveLength(0)
    await configurar(30, true)
  })

  it("reaplicar não muda nada", async () => {
    const antes = [await funcoes(db), await sql("select id, status, dedup_key, ultimo_erro from outbox_events order by id")]
    await db.exec(readFileSync(SCRIPT, "utf8"))
    expect([await funcoes(db), await sql("select id, status, dedup_key, ultimo_erro from outbox_events order by id")]).toEqual(antes)
  })
})
