/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Outbox/inbox, webhooks, lembretes e opt-out (F08-01 a F08-07; T16, T18, T13) em PostgreSQL local (PGlite).
// Nenhuma entrega real é feita: o envio ao WhatsApp é função do worker (Edge Function), bloqueado sem canal.
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite({ extensions: { btree_gist } })
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), donoB: U("b1"), barb1: U("c1"), cli1: U("d1"), cli2: U("d2"), cli3: U("d3"), cli4: U("d4"), cli5: U("d5") }
let loja = "", lojaB = "", corte = "", ana = ""

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

async function reservar(cliente: string, lembretes: boolean, marketing = false, whatsapp = "(11) 91234-5678"): Promise<string> {
  const dia = await val(null, "select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text")
  const slots = await rows(null, "select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, ana, dia])
  return val(cliente, "select create_booking($1, $2, $3, $4, 'Cliente', $7, $5, $6, null)", [loja, corte, ana, slots[0].slot_inicio, lembretes, marketing, whatsapp])
}
const agora = () => new Date().toISOString()
const hook = (event: string, from: string, context: string | null, texto: string, ts = agora()) =>
  svcVal("select process_whatsapp_reply($1, $2::timestamptz, $3, $4, $5)", [event, ts, from, context, texto])

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    grant usage on schema public to service_role;
  `)
  for (const f of ["0001_identidade_inicial"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  // 0007_site adiciona descricao, cor_destaque e media_objects, mas usa storage.buckets (não existe no PGlite)
  // Adicionamos as colunas ANTES de rodar 0012 porque get_public_shop (em 0012) referencia b.descricao, b.cor_destaque, b.template
  await db.exec(`
    alter table public.barbershops
      add column if not exists descricao text check (descricao is null or length(descricao) <= 500),
      add column if not exists cor_destaque text check (cor_destaque is null or cor_destaque in ('ambar', 'azul', 'verde', 'vermelho', 'violeta')),
      add column if not exists template text;
    create table if not exists public.media_objects (
      id uuid primary key default gen_random_uuid(),
      barbershop_id uuid not null references public.barbershops(id) on delete cascade,
      kind text not null check (kind in ('logo', 'capa', 'galeria')),
      storage_path text not null unique,
      mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
      tamanho_bytes integer not null check (tamanho_bytes between 1 and 2097152),
      criado_por uuid references public.profiles(id) on delete set null,
      criado_em timestamptz not null default now()
    );
    create unique index if not exists uq_media_logo_capa on public.media_objects (barbershop_id, kind) where kind in ('logo', 'capa');
    create index if not exists idx_media_shop on public.media_objects (barbershop_id, kind);
  `)
  for (const f of ["0002_catalogo", "0003_agenda", "0004_barbeiro", "0005_financeiro", "0006_eventos"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  // 0010_servico_imagem adiciona imagem_path em services e cria service_photos
  await db.exec(`alter table public.services add column if not exists imagem_path text check (imagem_path is null or length(imagem_path) <= 300);`)
  // 0010_servico_imagem adiciona service_photos. Criamos a tabela manualmente (depende de services criado em 0002)
  await db.exec(`
    create table if not exists public.service_photos (
      id uuid primary key default gen_random_uuid(),
      barbershop_id uuid not null references public.barbershops(id) on delete cascade,
      service_id uuid not null,
      storage_path text not null unique check (length(storage_path) <= 300),
      ordem integer not null default 0,
      criado_em timestamptz not null default now(),
      foreign key (service_id, barbershop_id) references public.services (id, barbershop_id) on delete cascade
    );
    create index if not exists idx_service_photos_service on public.service_photos (service_id, ordem);
  `)
  for (const f of ["0009_calendario", "0012_dados_barbearia", "0015_whatsapp_telefone", "0016_evolution_instance", "0017_reminder_config", "0018_fila_whatsapp"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])

  loja = await val(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")
  lojaB = await val(ID.donoB, "select create_barbershop('Barbearia B', 'barbearia-b')")
  await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'barbeiro')", [loja, ID.barb1])
  corte = (await rows(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [loja]))[0].id
  ana = await val(ID.dono, "select save_professional($1, null, 'Ana', true, $2)", [loja, [corte]])
  const semana = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))
  await rows(ID.dono, "select save_working_hours($1, $2)", [ana, semana])
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("F08-01: outbox transacional a partir dos eventos da reserva", () => {
  let comConsent = "", semConsent = ""
  it("reserva criada gera evento com payload completo, destino e chave de deduplicação", async () => {
    comConsent = await reservar(ID.cli1, true)
    semConsent = await reservar(ID.cli2, false)
    const [e] = await rows(ID.dono, "select * from outbox_events where booking_id = $1 and tipo = 'reserva_criada'", [comConsent])
    expect(e.status).toBe("pendente")
    expect(e.destino).toBe("11912345678")
    expect(e.payload).toMatchObject({ servico: "Corte", profissional: "Ana", fuso: "America/Sao_Paulo" })
    expect(e.payload.inicio).toBeTruthy()
    expect(e.dedup_key).toContain(comConsent)
  })

  it("sem consentimento de lembretes não há mensagem: o evento fica cancelado com o motivo", async () => {
    const [e] = await rows(ID.dono, "select status, ultimo_erro from outbox_events where booking_id = $1 and tipo = 'reserva_criada'", [semConsent])
    expect(e).toMatchObject({ status: "cancelado", ultimo_erro: "sem_consentimento" })
  })

  it("status e cancelamento também geram eventos; a chave impede duplicar", async () => {
    await rows(ID.cli1, "select cancel_booking($1)", [comConsent])
    const tipos = (await rows(ID.dono, "select tipo from outbox_events where booking_id = $1 order by criado_em, tipo", [comConsent])).map((r) => r.tipo)
    expect(tipos).toContain("reserva_cancelada")
    await expect(sql("insert into outbox_events (barbershop_id, tipo, destino, payload, dedup_key) select barbershop_id, tipo, destino, payload, dedup_key from outbox_events limit 1")).rejects.toThrow(/duplicate key|unique/)
  })

  it("só a gestão da empresa lê o outbox e os logs; cliente, barbeiro e outra empresa não", async () => {
    expect((await rows(ID.dono, "select 1 from outbox_events")).length).toBeGreaterThan(0)
    for (const u of [ID.cli1, ID.barb1, ID.donoB]) {
      expect(await rows(u, "select 1 from outbox_events")).toHaveLength(0)
      expect(await rows(u, "select 1 from notification_logs")).toHaveLength(0)
      expect(await rows(u, "select 1 from inbound_webhook_events")).toHaveLength(0)
    }
    await expect(rows(ID.dono, "insert into outbox_events (barbershop_id, tipo, destino, payload, dedup_key) values ($1, 'x', 'y', '{}', 'z')", [loja])).rejects.toThrow(/permission denied/)
  })
})

describe("F08-03: sem canal configurado nada é enviado nem simulado", () => {
  let reserva = ""
  it("o worker não recebe eventos de uma empresa sem WhatsApp ativo; eles ficam bloqueados", async () => {
    reserva = await reservar(ID.cli3, true)
    expect(await svc("select * from claim_outbox(10)")).toHaveLength(0)
    const [e] = await rows(ID.dono, "select status, ultimo_erro, tentativas from outbox_events where booking_id = $1 and tipo = 'reserva_criada'", [reserva])
    expect(e).toMatchObject({ status: "bloqueado", ultimo_erro: "canal_nao_configurado", tentativas: 0 })
  })

  it("com o canal ativo (operação de servidor) e liberação, o worker recebe o evento", async () => {
    await expect(rows(ID.dono, "select set_integration_status($1, 'whatsapp', 'ativo')", [loja])).rejects.toThrow(/permission denied/)
    await svc("select set_integration_status($1, 'whatsapp', 'ativo')", [loja])
    expect(Number(await svcVal("select release_blocked_outbox($1)", [loja]))).toBeGreaterThan(0)
    const got = await svc("select id, tipo, destino, tentativas from claim_outbox(10)")
    expect(got.map((g) => g.tipo)).toContain("reserva_criada")
    expect(got.every((g) => g.tentativas === 1)).toBe(true)
    expect(await svc("select * from claim_outbox(10)")).toHaveLength(0) // já em envio, não repete
  })
})

describe("F08-01: tentativas limitadas e registro de envios", () => {
  it("falha agenda nova tentativa com espera; ao esgotar, fica 'falhou'; sucesso grava o log", async () => {
    const r = await reservar(ID.cli4, true)
    const [ev] = await svc("select id from outbox_events where booking_id = $1 and tipo = 'reserva_criada'", [r])
    // coloca de volta na fila (o worker ainda não o reivindicou)
    await sql("update outbox_events set status = 'pendente', proximo_envio = now() where id = $1", [ev.id])
    let got = await svc("select id from claim_outbox(50)")
    expect(got.map((g) => g.id)).toContain(ev.id)
    await svc("select complete_outbox($1, false, null, 'timeout do provedor')", [ev.id])
    let [st] = await svc("select status, tentativas, ultimo_erro, proximo_envio > now() as espera from outbox_events where id = $1", [ev.id])
    expect(st).toMatchObject({ status: "pendente", tentativas: 1, ultimo_erro: "timeout do provedor", espera: true })
    expect((await svc("select id from claim_outbox(50)")).map((g) => g.id)).not.toContain(ev.id) // ainda em espera

    for (let i = 2; i <= 5; i++) {
      await sql("update outbox_events set proximo_envio = now() where id = $1", [ev.id])
      got = await svc("select id from claim_outbox(50)")
      expect(got.map((g) => g.id)).toContain(ev.id)
      await svc("select complete_outbox($1, false, null, 'erro')", [ev.id])
    }
    ;[st] = await svc("select status, tentativas from outbox_events where id = $1", [ev.id])
    expect(st).toMatchObject({ status: "falhou", tentativas: 5 })

    await sql("update outbox_events set status = 'pendente', tentativas = 0, proximo_envio = now() where id = $1", [ev.id])
    await svc("select * from claim_outbox(50)")
    await svc("select complete_outbox($1, true, 'wamid.ABC', null)", [ev.id])
    ;[st] = await svc("select status from outbox_events where id = $1", [ev.id])
    expect(st.status).toBe("enviado")
    expect((await rows(ID.dono, "select status, provider_message_id from notification_logs where outbox_id = $1 order by criado_em desc", [ev.id]))[0]).toMatchObject({ status: "enviado", provider_message_id: "wamid.ABC" })
    await svc("select complete_outbox($1, false, null, 'tarde')", [ev.id]) // evento já enviado não regride
    expect((await svc("select status from outbox_events where id = $1", [ev.id]))[0].status).toBe("enviado")
  })
})

describe("F08-06: lembretes configuráveis por barbearia e recuperação, com consentimento e opt-out (T18)", () => {
  it("um único lembrete por reserva com lead_time da configuração (padrão 30min)", async () => {
    const r = await reservar(ID.cli1, true)
    // Ajusta a reserva para daqui a 25 min (dentro da janela de 30min, mas fora de 15min)
    await sql("update bookings set criado_em = now() - interval '1 day', inicio = now() + interval '25 minutes', fim = now() + interval '65 minutes' where id = $1", [r])
    await svc("select schedule_reminders()")
    await svc("select schedule_reminders()") // idempotente
    const eventos = await rows(ID.dono, "select tipo from outbox_events where booking_id = $1 and tipo like 'lembrete_%'", [r])
    expect(eventos).toHaveLength(1)
    expect(eventos[0].tipo).toBe("lembrete_30min")
  })

  it("respeita lead_time_minutes personalizado (ex.: 120min = 2h)", async () => {
    await rows(ID.dono, "select save_site_profile($1, 'desc', 'azul', 'Rua Teste, 123', '(11) 91234-5678', '{\"auto_confirmation\": true, \"auto_reminder\": true, \"lead_time_minutes\": 120}'::jsonb)", [loja])
    const r = await reservar(ID.cli2, true)
    await sql("update bookings set criado_em = now() - interval '1 day', inicio = now() + interval '100 minutes', fim = now() + interval '140 minutes' where id = $1", [r])
    await svc("select schedule_reminders()")
    const eventos = await rows(ID.dono, "select tipo from outbox_events where booking_id = $1 and tipo like 'lembrete_%'", [r])
    expect(eventos).toHaveLength(1)
    expect(eventos[0].tipo).toBe("lembrete_120min")
  })

  it("auto_reminder = false desativa lembretes", async () => {
    await rows(ID.dono, "select save_site_profile($1, 'desc', 'azul', 'Rua Teste, 123', '(11) 91234-5678', '{\"auto_confirmation\": true, \"auto_reminder\": false, \"lead_time_minutes\": 30}'::jsonb)", [loja])
    const r = await reservar(ID.cli3, true)
    await sql("update bookings set criado_em = now() - interval '1 day', inicio = now() + interval '25 minutes', fim = now() + interval '65 minutes' where id = $1", [r])
    await svc("select schedule_reminders()")
    expect(await rows(ID.dono, "select 1 from outbox_events where booking_id = $1 and tipo like 'lembrete_%'", [r])).toHaveLength(0)
  })

  it("reserva dentro da janela recebe lembrete até o início; sem consentimento, nenhum", async () => {
    await rows(ID.dono, "select save_site_profile($1, 'desc', 'azul', 'Rua Teste, 123', '(11) 91234-5678', '{\"auto_confirmation\": true, \"auto_reminder\": true, \"lead_time_minutes\": 30}'::jsonb)", [loja])
    const a = await reservar(ID.cli1, true)
    const b = await reservar(ID.cli2, false)
    // 10 min antes: dentro da janela de 30min (inicio - 30min <= now < inicio)
    await sql("update bookings set inicio = now() + interval '10 minutes', fim = now() + interval '50 minutes' where id = any($1)", [[a, b]])
    await svc("select schedule_reminders()")
    // Com consentimento: recebe lembrete (janela vai até o início do atendimento)
    expect(await rows(ID.dono, "select 1 from outbox_events where booking_id = $1 and tipo like 'lembrete_%'", [a])).toHaveLength(1)
    // Sem consentimento: não recebe
    expect(await rows(ID.dono, "select 1 from outbox_events where booking_id = $1 and tipo like 'lembrete_%'", [b])).toHaveLength(0)
  })

  it("cancelamento invalida lembrete agendado (status cancelado remove da fila)", async () => {
    // Reduz cancel_window para 30min e usa lead_time de 60min para ter sobreposição
    await sql("update barbershops set cancel_window_min = 30 where id = $1", [loja])
    await rows(ID.dono, "select save_site_profile($1, 'desc', 'azul', 'Rua Teste, 123', '(11) 91234-5678', '{\"auto_confirmation\": true, \"auto_reminder\": true, \"lead_time_minutes\": 60}'::jsonb)", [loja])
    const r = await reservar(ID.cli1, true)
    // Reserva para daqui a 45 min (dentro da janela de 60min do lembrete, fora de 15min, e fora da janela de cancelamento de 30min)
    await sql("update bookings set criado_em = now() - interval '1 day', inicio = now() + interval '45 minutes', fim = now() + interval '85 minutes' where id = $1", [r])
    await svc("select schedule_reminders()")
    await rows(ID.cli1, "select cancel_booking($1)", [r])
    const ev = await rows(ID.dono, "select status, ultimo_erro from outbox_events where booking_id = $1 and tipo = 'lembrete_60min'", [r])
    expect(ev[0]).toMatchObject({ status: "cancelado", ultimo_erro: "reserva_cancelada" })
    // Restaura cancel_window padrão e reminder_config padrão (30min)
    await sql("update barbershops set cancel_window_min = 120 where id = $1", [loja])
    await rows(ID.dono, "select save_site_profile($1, 'desc', 'azul', 'Rua Teste, 123', '(11) 91234-5678', '{\"auto_confirmation\": true, \"auto_reminder\": true, \"lead_time_minutes\": 30}'::jsonb)", [loja])
  })

  it("reagendamento atualiza o horário do lembrete (novo lembrete para o novo horário)", async () => {
    // Limpa reservas anteriores deste cliente para evitar booking_limit
    await sql("update bookings set status = 'cancelado' where customer_id = $1 and status in ('pendente', 'confirmado')", [ID.cli1])
    const r = await reservar(ID.cli1, true)
    // Primeira reserva FORA da janela de lembrete (40 min > 30min lead time) -> sem lembrete
    await sql("update bookings set criado_em = now() - interval '1 day', inicio = now() + interval '40 minutes', fim = now() + interval '80 minutes' where id = $1", [r])
    await svc("select schedule_reminders()")
    // Reagenda para DENTRO da janela de lembrete (20 min, dentro de 30min, fora de 15min) -> cria lembrete
    await sql("update bookings set inicio = now() + interval '20 minutes', fim = now() + interval '60 minutes' where id = $1", [r])
    // O trigger gera reserva_reagendada; schedule_reminders cria o lembrete para o novo horário
    await svc("select schedule_reminders()")
    const eventos = await rows(ID.dono, "select tipo, status from outbox_events where booking_id = $1 and tipo like 'lembrete_%'", [r])
    // Deve ter apenas o novo lembrete pendente (o antigo não existia)
    const ativos = eventos.filter(e => e.status === "pendente")
    expect(ativos).toHaveLength(1)
    expect(ativos[0].tipo).toBe("lembrete_30min")
  })

  it("mudar lead_time de 60 para 30 min não duplica lembrete (reaproveita fila)", async () => {
    // Limpa reservas anteriores
    await sql("update bookings set status = 'cancelado' where customer_id = $1 and status in ('pendente', 'confirmado')", [ID.cli1])
    // Configura lead_time = 60min
    await rows(ID.dono, "select save_site_profile($1, 'desc', 'azul', 'Rua Teste, 123', '(11) 91234-5678', '{\"auto_confirmation\": true, \"auto_reminder\": true, \"lead_time_minutes\": 60}'::jsonb)", [loja])
    const r = await reservar(ID.cli1, true)
    // Reserva para daqui a 45 min (dentro da janela de 60min)
    await sql("update bookings set criado_em = now() - interval '1 day', inicio = now() + interval '45 minutes', fim = now() + interval '85 minutes' where id = $1", [r])
    await svc("select schedule_reminders()")
    // Verifica que lembrete_60min foi criado
    let eventos = await rows(ID.dono, "select tipo, status, dedup_key from outbox_events where booking_id = $1 and tipo like 'lembrete_%'", [r])
    expect(eventos.filter(e => e.status === 'pendente')).toHaveLength(1)
    expect(eventos[0].tipo).toBe("lembrete_60min")

    // Muda para lead_time = 30min (mesma reserva, mesmo horário)
    await rows(ID.dono, "select save_site_profile($1, 'desc', 'azul', 'Rua Teste, 123', '(11) 91234-5678', '{\"auto_confirmation\": true, \"auto_reminder\": true, \"lead_time_minutes\": 30}'::jsonb)", [loja])
    await svc("select schedule_reminders()")
    // Deve ter ATUALIZADO o lembrete existente, não criado novo
    eventos = await rows(ID.dono, "select tipo, status, dedup_key from outbox_events where booking_id = $1 and tipo like 'lembrete_%'", [r])
    const ativos = eventos.filter(e => e.status === 'pendente')
    expect(ativos).toHaveLength(1)
    expect(ativos[0].tipo).toBe("lembrete_30min")
    // Total de eventos de lembrete para esta reserva deve ser 1 (o antigo foi atualizado, não duplicado)
    expect(eventos).toHaveLength(1)

    // Restaura config padrão
    await rows(ID.dono, "select save_site_profile($1, 'desc', 'azul', 'Rua Teste, 123', '(11) 91234-5678', '{\"auto_confirmation\": true, \"auto_reminder\": true, \"lead_time_minutes\": 30}'::jsonb)", [loja])
  })

  it("recuperação em 30 dias só com consentimento de marketing; opt-out cancela o que estava na fila", async () => {
    // cli4: atendimento concluído há 31 dias, com marketing; cli2: concluído há 31 dias, sem marketing
    await sql("update bookings set status = 'cancelado' where customer_id = any($1) and status in ('pendente', 'confirmado')", [[ID.cli4, ID.cli2]])
    const m = await reservar(ID.cli4, true, true)
    const n = await reservar(ID.cli2, true, false)
    await sql("update bookings set status = 'concluido', inicio = now() - interval '31 days', fim = now() - interval '31 days' + interval '40 minutes' where id = any($1)", [[m, n]])
    await svc("select schedule_reactivation()")
    await svc("select schedule_reactivation()")
    const ev = await rows(ID.dono, "select customer_id, tipo, status from outbox_events where tipo = 'reativacao_30'")
    expect(ev.map((e) => e.customer_id)).toEqual([ID.cli4])
    expect(ev[0].status).toBe("pendente")

    await rows(ID.cli4, "select set_marketing_consent($1, false)", [loja])
    const audit = await rows(ID.dono, "select tipo from consent_events where profile_id = $1 order by criado_em", [ID.cli4])
    expect(audit.map((a) => a.tipo)).toEqual(["opt_in", "opt_out"])
    await svc("select * from claim_outbox(50)")
    expect((await rows(ID.dono, "select status, ultimo_erro from outbox_events where tipo = 'reativacao_30'"))[0]).toMatchObject({ status: "cancelado", ultimo_erro: "opt_out" })
    await sql("delete from outbox_events where tipo = 'reativacao_30'")
    await svc("select schedule_reactivation()")
    expect(await rows(ID.dono, "select 1 from outbox_events where tipo = 'reativacao_30'")).toHaveLength(0)
  })
})

describe("Etapa 2: janela e fila do lembrete (uma reserva + um horário = um lembrete)", () => {
  type Lembrete = { id: string; tipo: string; status: string; ultimo_erro: string | null; proximo_envio: string; payload: { inicio: string } }
  let numero = 0
  const antecedencia = (min: number) =>
    rows(ID.dono, "select save_site_profile($1, 'desc', 'azul', 'Rua Teste, 123', '(11) 91234-5678', $2::jsonb)", [loja, { auto_confirmation: true, auto_reminder: true, lead_time_minutes: min }])
  const moverPara = (r: string, minutos: number) =>
    sql("update bookings set criado_em = now() - interval '1 day', inicio = now() + make_interval(mins => $2::int), fim = now() + make_interval(mins => $2::int + 40) where id = $1", [r, minutos])
  async function reservaEm(minutos: number): Promise<string> {
    await sql("update bookings set status = 'cancelado' where customer_id = $1 and status in ('pendente', 'confirmado')", [ID.cli5])
    // mover a reserva por SQL não libera a ocupação; e um número novo mantém o teste longe do limite de 12 mensagens em 24h
    await sql("delete from occupancies where professional_id = $1", [ana])
    const r = await reservar(ID.cli5, true, false, `(11) 9${1000 + ++numero}-5678`)
    await moverPara(r, minutos)
    return r
  }
  const agendar = () => svc("select schedule_reminders()")
  const lembretes = async (r: string) => (await svc("select id, tipo, status, ultimo_erro, proximo_envio, payload from outbox_events where booking_id = $1 and tipo like 'lembrete_%' order by criado_em", [r])) as Lembrete[]
  const reivindicar = async () => (await svc("select id from claim_outbox(200)")).map((g) => g.id as string)
  const concluir = (id: string) => svc("select complete_outbox($1, true, 'wamid.ok', null)", [id])

  beforeAll(async () => {
    await svc("select set_integration_status($1, 'whatsapp', 'ativo')", [loja])
  })
  afterAll(async () => {
    await antecedencia(30)
  })

  it("15 min: com o agendador rodando depois do horário previsto (faltam 14 min), gera um lembrete e o worker o recebe", async () => {
    await antecedencia(15)
    const r = await reservaEm(14)
    await agendar()
    await agendar() // idempotente
    const [l, ...resto] = await lembretes(r)
    expect(resto).toHaveLength(0)
    expect(l).toMatchObject({ tipo: "lembrete_15min", status: "pendente" })
    expect(await reivindicar()).toContain(l.id)
  })

  it("15 min: antes da janela (faltam 16 min) ainda não gera", async () => {
    await antecedencia(15)
    const r = await reservaEm(16)
    await agendar()
    expect(await lembretes(r)).toHaveLength(0)
  })

  it("reserva cujo início já passou não gera lembrete", async () => {
    await antecedencia(15)
    const r = await reservaEm(-1)
    await agendar()
    expect(await lembretes(r)).toHaveLength(0)
  })

  it("lembrete na fila não é enviado depois do início: pendente, em nova tentativa ou bloqueado", async () => {
    await antecedencia(30)
    for (const preparar of ["pendente", "nova_tentativa", "bloqueado"] as const) {
      const r = await reservaEm(20)
      await agendar()
      const [l] = await lembretes(r)
      if (preparar === "nova_tentativa") {
        expect(await reivindicar()).toContain(l.id)
        await svc("select complete_outbox($1, false, null, 'timeout')", [l.id])
      }
      if (preparar === "bloqueado") await sql("update outbox_events set status = 'bloqueado' where id = $1", [l.id])
      // o início passa enquanto o lembrete espera na fila
      await sql("update bookings set inicio = now() - interval '1 minute', fim = now() + interval '39 minutes' where id = $1", [r])
      await sql("update outbox_events set proximo_envio = now(), payload = payload || jsonb_build_object('inicio', now() - interval '1 minute') where id = $1", [l.id])
      if (preparar === "bloqueado") await svc("select release_blocked_outbox($1)", [loja])
      expect(await reivindicar(), preparar).not.toContain(l.id)
      const [depois] = await lembretes(r)
      expect(depois, preparar).toMatchObject({ status: "cancelado", ultimo_erro: "reserva_vencida" })
    }
  })

  it("60 → 30 com o lembrete ainda na fila: a mesma linha muda de tipo e espera a nova janela", async () => {
    await antecedencia(60)
    const r = await reservaEm(45)
    await agendar()
    const [antes] = await lembretes(r)
    expect(antes.tipo).toBe("lembrete_60min")
    await antecedencia(30)
    await agendar()
    await agendar()
    const todos = await lembretes(r)
    expect(todos).toHaveLength(1)
    expect(todos[0]).toMatchObject({ id: antes.id, tipo: "lembrete_30min", status: "pendente" })
    expect(new Date(todos[0].proximo_envio).getTime()).toBeGreaterThan(Date.now())
    expect(await reivindicar()).not.toContain(antes.id) // só sai a 30 min do início
  })

  it("60 → 30 com o lembrete já enviado: não envia de novo", async () => {
    await antecedencia(60)
    const r = await reservaEm(25)
    await agendar()
    const [l] = await lembretes(r)
    expect(await reivindicar()).toContain(l.id)
    await concluir(l.id)
    await antecedencia(30)
    await agendar()
    const todos = await lembretes(r)
    expect(todos).toHaveLength(1)
    expect(todos[0]).toMatchObject({ id: l.id, tipo: "lembrete_60min", status: "enviado" })
    expect(await reivindicar()).not.toContain(l.id)
  })

  it("60 → 30 durante o envio: o lembrete em andamento não volta para a fila", async () => {
    await antecedencia(60)
    const r = await reservaEm(25)
    await agendar()
    const [l] = await lembretes(r)
    expect(await reivindicar()).toContain(l.id)
    await antecedencia(30)
    await agendar()
    expect((await lembretes(r))[0].status).toBe("enviando")
    expect(await reivindicar()).not.toContain(l.id)
    await concluir(l.id)
    expect((await lembretes(r))[0].status).toBe("enviado")
  })

  it("o agendador não apaga a espera da nova tentativa nem ressuscita o que falhou", async () => {
    await antecedencia(30)
    const r = await reservaEm(25)
    await agendar()
    const [l] = await lembretes(r)
    expect(await reivindicar()).toContain(l.id)
    await svc("select complete_outbox($1, false, null, 'timeout')", [l.id])
    await agendar()
    expect(await reivindicar()).not.toContain(l.id) // continua em espera
    await sql("update outbox_events set status = 'falhou' where id = $1", [l.id])
    await agendar()
    expect((await lembretes(r))[0].status).toBe("falhou")
  })

  it("reagendar depois do envio gera um novo lembrete para o novo horário", async () => {
    await antecedencia(30)
    const r = await reservaEm(20)
    await agendar()
    const [enviado] = await lembretes(r)
    expect(await reivindicar()).toContain(enviado.id)
    await concluir(enviado.id)
    await moverPara(r, 25)
    await agendar()
    const todos = await lembretes(r)
    expect(todos).toHaveLength(2)
    const novo = todos.find((l) => l.id !== enviado.id)!
    expect(novo).toMatchObject({ tipo: "lembrete_30min", status: "pendente" })
    expect(novo.payload.inicio).not.toBe(enviado.payload.inicio)
    expect(await reivindicar()).toContain(novo.id)
  })

  it("reagendar com lembrete na fila só envia o do novo horário; voltar ao horário antigo reativa o antigo", async () => {
    await antecedencia(30)
    const r = await reservaEm(20)
    await agendar()
    const [antigo] = await lembretes(r)
    await moverPara(r, 25)
    await agendar()
    const novo = (await lembretes(r)).find((l) => l.id !== antigo.id)!
    const enviados = await reivindicar()
    expect(enviados).toContain(novo.id)
    expect(enviados).not.toContain(antigo.id)
    expect((await lembretes(r)).find((l) => l.id === antigo.id)).toMatchObject({ status: "cancelado", ultimo_erro: "reserva_reagendada" })
    await concluir(novo.id)

    await sql("update bookings set inicio = $2::timestamptz where id = $1", [r, antigo.payload.inicio])
    await agendar()
    const todos = await lembretes(r)
    expect(todos).toHaveLength(2)
    expect(todos.find((l) => l.id === antigo.id)).toMatchObject({ status: "pendente", ultimo_erro: null })
    expect(await reivindicar()).toContain(antigo.id)
  })
})

describe("Etapa 3: fechamento da fila (janela da antecedência ao início, troca de antecedência, reconexão e confirmação)", () => {
  type Linha = { id: string; tipo: string; status: string; ultimo_erro: string | null }
  type Config = { auto_confirmation: boolean; auto_reminder: boolean; lead_time_minutes: number }
  const LEADS = [15, 30, 60, 120] as const
  let numero = 500
  const config = (c: Partial<Config> = {}) =>
    rows(ID.dono, "select save_site_profile($1, 'desc', 'azul', 'Rua Teste, 123', '(11) 91234-5678', $2::jsonb)", [loja, { auto_confirmation: true, auto_reminder: true, lead_time_minutes: 30, ...c }])
  const moverPara = (r: string, minutos: number) =>
    sql("update bookings set criado_em = now() - interval '1 day', inicio = now() + make_interval(mins => $2::int), fim = now() + make_interval(mins => $2::int + 40) where id = $1", [r, minutos])
  async function reservaEm(minutos: number): Promise<string> {
    await sql("update bookings set status = 'cancelado' where customer_id = $1 and status in ('pendente', 'confirmado')", [ID.cli5])
    await sql("delete from occupancies where professional_id = $1", [ana])
    const r = await reservar(ID.cli5, true, false, `(11) 9${1000 + ++numero}-5678`)
    await moverPara(r, minutos)
    return r
  }
  const agendar = () => svc("select schedule_reminders()")
  const eventosDe = async (r: string, tipo: string) =>
    (await svc("select id, tipo, status, ultimo_erro from outbox_events where booking_id = $1 and tipo like $2 order by criado_em", [r, tipo])) as Linha[]
  const lembretes = (r: string) => eventosDe(r, "lembrete_%")
  const reivindicar = async () => (await svc("select id from claim_outbox(200)")).map((g) => g.id as string)
  const concluir = (id: string) => svc("select complete_outbox($1, true, 'wamid.ok', null)", [id])
  const canal = (status: "ativo" | "suspenso") => svc("select set_integration_status($1, 'whatsapp', $2)", [loja, status])
  const reconectar = async () => {
    await canal("ativo")
    return svcVal("select release_blocked_outbox($1)", [loja])
  }
  // o tempo passa com o lembrete na fila: a reserva (e o retrato dela no payload) passa a começar daqui a `minutos`
  const faltando = async (r: string, lembrete: string, minutos: number) => {
    await sql("update bookings set inicio = now() + make_interval(mins => $2::int), fim = now() + make_interval(mins => $2::int + 40) where id = $1", [r, minutos])
    await sql("update outbox_events set payload = payload || jsonb_build_object('inicio', (select inicio from bookings where id = $2)) where id = $1", [lembrete, r])
  }
  const confirmar = async (r: string) => {
    await sql("update bookings set status = 'pendente' where id = $1", [r])
    await rows(ID.dono, "select set_booking_status($1, 'confirmado')", [r])
  }

  beforeAll(async () => {
    await canal("ativo")
  })
  afterAll(async () => {
    await config()
    await canal("ativo")
    // reconectar libera também os bloqueados dos blocos anteriores, e o claim(200) daqui não conclui o que pega:
    // não deixa fila nem envio em aberto para os próximos blocos (o claim deles tem limite)
    await sql("update outbox_events set status = 'cancelado', ultimo_erro = 'fim_do_teste' where barbershop_id = $1 and status in ('pendente', 'bloqueado', 'enviando')", [loja])
  })

  it("agendador: a janela abre na antecedência e fecha no início, igual para 15, 30, 60 e 120 min", async () => {
    for (const lead of LEADS) {
      await config({ lead_time_minutes: lead })
      const antes = await reservaEm(lead + 1) // janela ainda fechada
      await agendar()
      expect(await lembretes(antes), `${lead} min: antes de abrir`).toHaveLength(0)
      const abertura = await reservaEm(lead - 1) // logo depois de abrir
      await agendar()
      expect(await lembretes(abertura), `${lead} min: na abertura`).toHaveLength(1)
      const fim = await reservaEm(1) // agendador atrasado, faltando 1 min: ainda aberta
      await agendar()
      expect(await lembretes(fim), `${lead} min: faltando 1 min`).toHaveLength(1)
      const depois = await reservaEm(-1) // o atendimento já começou
      await agendar()
      expect(await lembretes(depois), `${lead} min: depois do início`).toHaveLength(0)
    }
  })

  it("fila: o lembrete que espera ainda sai faltando 1 min e é descartado do início em diante, igual para 15, 30, 60 e 120 min", async () => {
    for (const lead of LEADS) {
      await config({ lead_time_minutes: lead })
      const r = await reservaEm(lead - 1)
      await agendar()
      const [l] = await lembretes(r)
      await faltando(r, l.id, 1)
      expect(await reivindicar(), `${lead} min: faltando 1 min`).toContain(l.id)
      await concluir(l.id)
      const v = await reservaEm(lead - 1)
      await agendar()
      const [lv] = await lembretes(v)
      await faltando(v, lv.id, -1) // o início passa com o lembrete na fila
      expect(await reivindicar(), `${lead} min: depois do início`).not.toContain(lv.id)
      expect((await lembretes(v))[0], `${lead} min`).toMatchObject({ status: "cancelado", ultimo_erro: "reserva_vencida" })
    }
  })

  it("trocar a antecedência várias vezes (30→60→120→15→30) mantém um único lembrete e não reenvia depois do envio", async () => {
    await config({ lead_time_minutes: 30 })
    const r = await reservaEm(25)
    await agendar()
    const [primeiro] = await lembretes(r)
    for (const lead of [60, 120, 15, 30]) {
      await config({ lead_time_minutes: lead })
      await agendar()
      await agendar()
      const todos = await lembretes(r)
      expect(todos, `antecedência ${lead}`).toHaveLength(1)
      expect(todos[0].id).toBe(primeiro.id)
    }
    expect(await reivindicar()).toContain(primeiro.id)
    await concluir(primeiro.id)
    for (const lead of [60, 15]) {
      await config({ lead_time_minutes: lead })
      await agendar()
    }
    expect(await lembretes(r)).toHaveLength(1)
    expect(await reivindicar()).not.toContain(primeiro.id)
  })

  it("reconexão: libera o lembrete com a janela aberta (faltando 1 min) e descarta o que passou do início, igual para 15, 30, 60 e 120 min", async () => {
    for (const lead of LEADS) {
      await config({ lead_time_minutes: lead })
      await canal("suspenso")
      const vencera = await reservaEm(lead - 1)
      await agendar()
      const valida = await reservaEm(lead - 1)
      await agendar()
      await reivindicar() // sem canal: os dois ficam bloqueados
      const [lv] = await lembretes(vencera)
      const [lo] = await lembretes(valida)
      expect([lv.status, lo.status], `${lead} min`).toEqual(["bloqueado", "bloqueado"])
      await faltando(vencera, lv.id, -1) // a conexão volta depois do início deste
      await faltando(valida, lo.id, 1) // e faltando 1 min para este
      await reconectar()
      expect((await lembretes(vencera))[0], `${lead} min`).toMatchObject({ status: "cancelado", ultimo_erro: "reserva_vencida" })
      expect((await lembretes(valida))[0].status, `${lead} min`).toBe("pendente")
      const enviados = await reivindicar()
      expect(enviados, `${lead} min`).toContain(lo.id)
      expect(enviados, `${lead} min`).not.toContain(lv.id)
    }
  })

  it("reconectar com o lembrete automático desligado não envia o que estava bloqueado", async () => {
    await config({ lead_time_minutes: 30 })
    await canal("suspenso")
    const r = await reservaEm(25)
    await agendar()
    await reivindicar()
    const [l] = await lembretes(r)
    expect(l.status).toBe("bloqueado")
    await config({ auto_reminder: false })
    await reconectar()
    expect(await reivindicar()).not.toContain(l.id)
    expect((await lembretes(r))[0]).toMatchObject({ status: "cancelado", ultimo_erro: "lembrete_desativado" })
  })

  it("confirmação: reserva que nasce confirmada enfileira exatamente uma; repetir a confirmação não duplica", async () => {
    await config({ auto_confirmation: true })
    const r = await reservaEm(180)
    const fila = await eventosDe(r, "reserva_confirmada")
    expect(fila).toHaveLength(1)
    expect(fila[0].status).toBe("pendente")
    await confirmar(r) // mesmo que um novo evento de confirmação aconteça, a chave é da reserva
    expect(await eventosDe(r, "reserva_confirmada")).toHaveLength(1)
  })

  it("confirmação: reserva pendente aceita enfileira exatamente uma", async () => {
    await config({ auto_confirmation: true })
    const r = await reservaEm(180)
    // reserva que nasceu pendente: sem a confirmação do nascimento
    await sql("delete from outbox_events where booking_id = $1 and tipo = 'reserva_confirmada'", [r])
    await confirmar(r)
    const fila = await eventosDe(r, "reserva_confirmada")
    expect(fila).toHaveLength(1)
    expect(fila[0].status).toBe("pendente")
  })

  it("confirmação: com auto_confirmation desligada, nem nascer confirmada nem aceitar enfileira", async () => {
    await config({ auto_confirmation: false })
    const r = await reservaEm(180)
    expect(await eventosDe(r, "reserva_confirmada")).toHaveLength(0)
    await confirmar(r)
    expect(await eventosDe(r, "reserva_confirmada")).toHaveLength(0)
  })

  it("confirmação: sem consentimento de avisos nada sai; fica só o registro cancelado", async () => {
    await config({ auto_confirmation: true })
    await sql("update bookings set status = 'cancelado' where customer_id = $1 and status in ('pendente', 'confirmado')", [ID.cli5])
    await sql("delete from occupancies where professional_id = $1", [ana])
    const r = await reservar(ID.cli5, false, false, `(11) 9${1000 + ++numero}-5678`)
    const fila = await eventosDe(r, "reserva_confirmada")
    expect(fila).toHaveLength(1)
    expect(fila[0]).toMatchObject({ status: "cancelado", ultimo_erro: "sem_consentimento" })
    expect(await reivindicar()).not.toContain(fila[0].id)
  })

  it("confirmação: desligar depois de enfileirada e reconectar não envia", async () => {
    await config({ auto_confirmation: true })
    await canal("suspenso")
    const r = await reservaEm(180)
    await confirmar(r)
    await reivindicar()
    const [c] = await eventosDe(r, "reserva_confirmada")
    expect(c.status).toBe("bloqueado")
    await config({ auto_confirmation: false })
    await reconectar()
    expect(await reivindicar()).not.toContain(c.id)
    expect((await eventosDe(r, "reserva_confirmada"))[0]).toMatchObject({ status: "cancelado", ultimo_erro: "confirmacao_desativada" })
  })
})

describe("F08-02/05: webhooks falsos, duplicados e fora de ordem (T16)", () => {
  let reserva = "", wamid = ""
  beforeAll(async () => {
    // Limpa todas as reservas futuras do profissional para liberar horários
    await sql("update bookings set status = 'cancelado' where professional_id = $1 and inicio > now() and status in ('pendente', 'confirmado')", [ana])
    // Limpa ocupações órfãs
    await sql("delete from occupancies where professional_id = $1 and lower(periodo) > now()", [ana])
  })
  it("prepara uma reserva pendente com confirmação enviada", async () => {
    // Limpa reservas anteriores para evitar booking_limit
    await sql("update bookings set status = 'cancelado' where customer_id in ($1, $2, $3) and status in ('pendente', 'confirmado')", [ID.cli1, ID.cli2, ID.cli3])
    await sql("update outbox_events set atualizado_em = now() - interval '2 days' where status in ('enviado', 'enviando')")
    reserva = await reservar(ID.cli1, true)
    await sql("update bookings set status = 'pendente' where id = $1", [reserva])
    const [ev] = await svc("select id from outbox_events where booking_id = $1 and tipo = 'reserva_criada'", [reserva])
    await sql("update outbox_events set status = 'pendente', proximo_envio = now() where id = $1", [ev.id])
    await svc("select * from claim_outbox(50)")
    wamid = `wamid.${reserva.slice(0, 8)}`
    await svc("select complete_outbox($1, true, $2, null)", [ev.id, wamid])
  })

  it("resposta sem correlação a uma mensagem nossa não altera nada", async () => {
    expect(await hook("evt-1", "5511912345678", "wamid.FALSO", "SIM")).toBe("ignorado")
    expect(await hook("evt-2", "5511912345678", null, "SIM")).toBe("ignorado")
    expect(await val(ID.dono, "select status from bookings where id = $1", [reserva])).toBe("pendente")
  })

  it("número diferente do da reserva é ignorado", async () => {
    expect(await hook("evt-3", "5511999990000", wamid, "SIM")).toBe("ignorado")
    expect(await val(ID.dono, "select status from bookings where id = $1", [reserva])).toBe("pendente")
  })

  it("texto fora de SIM/NÃO é ignorado; evento muito antigo ou do futuro é rejeitado (replay)", async () => {
    expect(await hook("evt-4", "5511912345678", wamid, "talvez")).toBe("ignorado")
    expect(await hook("evt-5", "5511912345678", wamid, "SIM", new Date(Date.now() - 3600_000).toISOString())).toBe("rejeitado")
    expect(await hook("evt-6", "5511912345678", wamid, "SIM", new Date(Date.now() + 3600_000).toISOString())).toBe("rejeitado")
    expect(await val(ID.dono, "select status from bookings where id = $1", [reserva])).toBe("pendente")
  })

  it("SIM correlacionado confirma uma vez; o mesmo evento repetido é duplicado e nada muda", async () => {
    expect(await hook("evt-7", "+55 (11) 91234-5678", wamid, " Sim ")).toBe("processado")
    expect(await val(ID.dono, "select status from bookings where id = $1", [reserva])).toBe("confirmado")
    const antes = await rows(ID.dono, "select count(*)::int as n from booking_events where booking_id = $1", [reserva])
    expect(await hook("evt-7", "+55 (11) 91234-5678", wamid, "SIM")).toBe("duplicado")
    const depois = await rows(ID.dono, "select count(*)::int as n from booking_events where booking_id = $1", [reserva])
    expect(depois[0].n).toBe(antes[0].n)
  })

  it("NÃO cancela dentro da janela e libera o horário; depois, resposta atrasada em reserva final é ignorada", async () => {
    expect(await hook("evt-8", "5511912345678", wamid, "não")).toBe("processado")
    expect(await val(ID.dono, "select status from bookings where id = $1", [reserva])).toBe("cancelado")
    expect(await val(ID.dono, "select occupancy_id is null from bookings where id = $1", [reserva])).toBe(true)
    expect(await hook("evt-9", "5511912345678", wamid, "SIM")).toBe("ignorado")
    expect(await val(ID.dono, "select status from bookings where id = $1", [reserva])).toBe("cancelado")
  })

  it("NÃO dentro da janela de cancelamento, ou após reagendar, não cancela", async () => {
    const r = await reservar(ID.cli2, true)
    const [ev] = await svc("select id from outbox_events where booking_id = $1 and tipo = 'reserva_criada'", [r])
    await sql("update outbox_events set status = 'pendente', proximo_envio = now() where id = $1", [ev.id])
    await svc("select * from claim_outbox(50)")
    await svc("select complete_outbox($1, true, $2, null)", [ev.id, "wamid.JANELA"])
    await sql("update bookings set inicio = now() + interval '30 minutes', fim = now() + interval '70 minutes' where id = $1", [r])
    expect(await hook("evt-10", "5511912345678", "wamid.JANELA", "NAO")).toBe("ignorado") // inicio mudou desde a mensagem
    expect(await val(ID.dono, "select status from bookings where id = $1", [r])).toBe("confirmado")
  })

  it("NÃO não cancela reserva com pagamento recebido (a gestão estorna antes)", async () => {
    await sql("update bookings set status = 'cancelado' where customer_id = $1 and status in ('pendente', 'confirmado')", [ID.cli3]) // libera o limite de reservas
    await sql("update outbox_events set atualizado_em = now() - interval '2 days' where status in ('enviado', 'enviando')") // novo dia: zera o limite por número
    const r = await reservar(ID.cli3, true)
    const [ev] = await svc("select id from outbox_events where booking_id = $1 and tipo = 'reserva_criada'", [r])
    await sql("update outbox_events set status = 'pendente', proximo_envio = now() where id = $1", [ev.id])
    await svc("select * from claim_outbox(50)")
    await svc("select complete_outbox($1, true, $2, null)", [ev.id, "wamid.PAGO"])
    await rows(ID.dono, "select register_payment($1, 6000, 'pix', 1, 'k-whats-pago')", [r])
    expect(await hook("evt-pago", "5511912345678", "wamid.PAGO", "NÃO")).toBe("ignorado")
    expect(await val(ID.dono, "select status from bookings where id = $1", [r])).toBe("confirmado")
    expect((await rows(ID.dono, "select motivo from inbound_webhook_events where event_id = 'evt-pago'"))[0].motivo).toBe("com_pagamento")
  })

  it("PARAR registra o opt-out de marketing do número, de forma auditável", async () => {
    await rows(ID.cli3, "select set_marketing_consent($1, true)", [loja])
    expect(await hook("evt-11", "5511912345678", null, "PARAR")).toBe("processado")
    expect(await val(ID.dono, "select marketing from customer_consents where profile_id = $1", [ID.cli3])).toBe(false)
    expect((await rows(ID.dono, "select origem from consent_events where profile_id = $1 and tipo = 'opt_out'", [ID.cli3]))[0].origem).toBe("whatsapp")
  })

  it("segurança: PARAR bloqueia o número para TODOS os avisos, inclusive os da reserva, e vale para eventos futuros", async () => {
    // risco reproduzido: um cliente pode cadastrar o WhatsApp de um terceiro com consentimento marcado
    await sql("delete from phone_blocklist where telefone = '1112345678'")
    await sql("insert into phone_blocklist (barbershop_id, telefone) values ($1, '1112345678')", [loja])
    // Limpa reservas anteriores deste cliente para evitar booking_limit e liberar horários
    await sql("update bookings set status = 'cancelado' where customer_id = $1 and status in ('pendente', 'confirmado')", [ID.cli4])
    const r = await reservar(ID.cli4, true)
    const [ev] = await svc("select id from outbox_events where booking_id = $1 and tipo = 'reserva_criada'", [r])
    await sql("update outbox_events set status = 'pendente', proximo_envio = now() where id = $1", [ev.id])
    const got = await svc("select id from claim_outbox(50)")
    expect(got.map((g) => g.id)).not.toContain(ev.id)
    expect((await rows(ID.dono, "select status, ultimo_erro from outbox_events where id = $1", [ev.id]))[0]).toMatchObject({ status: "cancelado", ultimo_erro: "numero_bloqueado" })
  })

  it("segurança: no máximo 12 mensagens por número em 24h (impede usar a barbearia para spam)", async () => {
    await sql("delete from phone_blocklist")
    const [{ id: shop }] = await sql("select id from barbershops limit 1")
    for (let i = 0; i < 12; i++) await sql("insert into outbox_events (barbershop_id, tipo, destino, payload, dedup_key, status) values ($1, 'lembrete_2h', '11977776666', '{}', $2, 'enviado')", [shop, `cap-${i}`])
    await sql("insert into outbox_events (barbershop_id, tipo, destino, payload, dedup_key) values ($1, 'lembrete_2h', '11977776666', '{}', 'cap-novo')", [shop])
    await svc("select * from claim_outbox(50)")
    expect((await sql("select status, ultimo_erro from outbox_events where dedup_key = 'cap-novo'"))[0]).toMatchObject({ status: "cancelado", ultimo_erro: "limite_destino" })
  })

  it("limite de eventos por minuto protege o endpoint", async () => {
    await sql("insert into inbound_webhook_events (provider, event_id, ts_evento, status) select 'whatsapp', 'flood-' || g, now(), 'ignorado' from generate_series(1, 300) g")
    await expect(hook("evt-flood", "5511912345678", null, "SIM")).rejects.toThrow(/rate_limited/)
  })
})

describe("apagar mensagem (lixeira do painel)", () => {
  it("a gestão apaga o evento e os registros de envio; a reserva continua; os demais não apagam", async () => {
    // Limpa reservas anteriores deste cliente para evitar booking_limit e liberar horários
    await sql("update bookings set status = 'cancelado' where customer_id = $1 and status in ('pendente', 'confirmado')", [ID.cli4])
    const r = await reservar(ID.cli4, true)
    const [ev] = await svc("select id from outbox_events where booking_id = $1 and tipo = 'reserva_criada'", [r])
    await sql("insert into notification_logs (outbox_id, barbershop_id, status, erro) select id, barbershop_id, 'falhou', 'x' from outbox_events where id = $1", [ev.id])
    for (const u of [ID.cli4, ID.barb1, ID.donoB]) await expect(rows(u, "select delete_outbox_event($1)", [ev.id])).rejects.toThrow(/forbidden/)
    await rows(ID.dono, "select delete_outbox_event($1)", [ev.id])
    expect(await sql("select 1 from outbox_events where id = $1", [ev.id])).toHaveLength(0)
    expect(await sql("select 1 from notification_logs where outbox_id = $1", [ev.id])).toHaveLength(0)
    expect(await val(ID.dono, "select status from bookings where id = $1", [r])).toBe("confirmado")
    expect((await sql("select 1 from audit_logs where acao = 'outbox.deleted'")).length).toBeGreaterThan(0)
  })

  it("não apaga o que o worker está enviando agora; evento inexistente é recusado; anônimo não executa", async () => {
    const [ev] = await svc("select id from outbox_events where barbershop_id = $1 limit 1", [loja])
    await sql("update outbox_events set status = 'enviando' where id = $1", [ev.id])
    await expect(rows(ID.dono, "select delete_outbox_event($1)", [ev.id])).rejects.toThrow(/in_flight/)
    await expect(rows(ID.dono, "select delete_outbox_event(gen_random_uuid())")).rejects.toThrow(/forbidden/)
    await expect(rows(null, "select delete_outbox_event($1)", [ev.id])).rejects.toThrow(/permission denied/)
  })
})

describe("F08-07 / T13: permissões das funções de servidor", () => {
  it("clientes autenticados e anônimos não executam funções do worker nem do webhook", async () => {
    const chamadas = [
      "select * from claim_outbox(1)",
      "select complete_outbox(gen_random_uuid(), true, null, null)",
      "select schedule_reminders()",
      "select schedule_reactivation()",
      "select process_whatsapp_reply('x', now(), '1', null, 'sim')",
      "select set_integration_status(gen_random_uuid(), 'whatsapp', 'ativo')",
    ]
    for (const c of chamadas) {
      await expect(rows(ID.dono, c)).rejects.toThrow(/permission denied/)
      await expect(rows(null, c)).rejects.toThrow(/permission denied/)
    }
  })

  it("a gestão acompanha o resumo de envios e falhas da própria empresa", async () => {
    const r = await rows(ID.dono, "select status, total from outbox_summary($1)", [loja])
    expect(r.length).toBeGreaterThan(0)
    await expect(rows(ID.donoB, "select * from outbox_summary($1)", [loja])).rejects.toThrow(/forbidden/)
    await expect(rows(ID.cli1, "select * from outbox_summary($1)", [loja])).rejects.toThrow(/forbidden/)
    expect(lojaB).toBeTruthy()
  })
})
