/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Alerta de segurança no Telegram (0054) em PostgreSQL local (PGlite), com pg_cron, pg_net e Vault simulados.
// Nada aqui toca o banco remoto nem o Telegram.
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const AMBIENTE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}', created_at timestamptz not null default now());
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
// pg_cron (com o histórico de execuções), pg_net e Vault simulados com os mesmos nomes usados no Supabase
const SIMULADOS = `
  create schema vault; create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
  create schema net;
  create table net.pedidos (id bigserial primary key, url text, body jsonb, headers jsonb, timeout_milliseconds integer);
  create table net._http_response (id bigint primary key, status_code integer, content text, timed_out boolean, error_msg text);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
    returns bigint language sql as $$ insert into net.pedidos (url, body, headers, timeout_milliseconds) values (url, body, headers, timeout_milliseconds) returning id $$;
  create schema cron; create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
  create table cron.job_run_details (runid bigserial primary key, jobid bigint, status text, start_time timestamptz default now());
  create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
    insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
`
const TOKEN = "123456:TOKEN-FICTICIO-DO-BOT"
const db = new PGlite({ extensions: { btree_gist } })
let loja = ""
const q = async (sql: string, p: unknown[] = []) => (await db.query<Record<string, any>>(sql, p)).rows
const pedidos = () => q("select url, body from net.pedidos order by id")
const segredos = () => db.exec(`insert into vault.decrypted_secrets values ('barberia_telegram_token', '${TOKEN}'), ('barberia_telegram_chat_id', '987654') on conflict (name) do nothing`)

beforeAll(async () => {
  await db.exec(AMBIENTE)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql") && x < "0051").sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  await db.exec(SIMULADOS)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql") && x >= "0051" && x < "0054").sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  await db.exec(readFileSync("supabase/migrations/0054_alerta_seguranca.sql", "utf8"))
  const dono = (await q("insert into auth.users (email, created_at) values ('dono@example.test', now() - interval '3 days') returning id"))[0].id
  loja = (await q("insert into public.barbershops (owner_id, nome, slug) values ($1, 'Barbearia do Tico', 'barbearia-do-tico') returning id", [dono]))[0].id
}, 120_000)

afterAll(async () => { await db.close() })

beforeEach(async () => {
  await db.exec("delete from net.pedidos; delete from cron.job_run_details; delete from public.outbox_events; delete from vault.decrypted_secrets; delete from private.media_cleanup_runs;")
  await db.exec("update auth.users set created_at = now() - interval '3 days'")
})

describe("alerta de segurança no Telegram (0054)", () => {
  it("sem nada estranho na última hora, não envia nada", async () => {
    await segredos()
    expect((await q("select private.verificar_alertas() as m"))[0].m).toBeNull()
    expect(await pedidos()).toHaveLength(0)
  })

  it("cadastro em massa (20 ou mais contas na última hora) manda alerta ao Telegram com o token e o chat do Vault", async () => {
    await segredos()
    await db.exec("insert into auth.users (email) select 'robo' || g || '@example.test' from generate_series(1, 20) g")
    const m = (await q("select private.verificar_alertas() as m"))[0].m
    expect(m).toContain("20 contas novas")
    const [p] = await pedidos()
    expect(p.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(p.body).toMatchObject({ chat_id: "987654" })
    expect(p.body.text).toContain("20 contas novas")
  })

  it("rotina automática com erro e fila do WhatsApp falhando entram no mesmo alerta", async () => {
    await segredos()
    await db.exec("insert into cron.job_run_details (jobid, status) select jobid, 'failed' from cron.job where jobname = 'barberia-limpeza-midia'")
    await db.query("insert into public.outbox_events (barbershop_id, tipo, destino, dedup_key, status) select $1, 'reserva_confirmada', '5564992750733', 'teste-' || g, 'falhou' from generate_series(1, 5) g", [loja])
    await db.exec("insert into private.media_cleanup_runs (status_http, erro, concluido_em) values (500, 'http_500', now())")
    const m = (await q("select private.verificar_alertas() as m"))[0].m
    expect(m).toContain("barberia-limpeza-midia")
    expect(m).toContain("Limpeza de mídia com erro: http_500")
    expect(m).toContain("5 mensagens de WhatsApp falharam")
    expect(await pedidos()).toHaveLength(1)
  })

  it("abaixo dos limites (19 contas, 4 falhas, rotina com sucesso) não alerta", async () => {
    await segredos()
    await db.exec("insert into auth.users (email) select 'pessoa' || g || '@example.test' from generate_series(1, 19) g")
    await db.exec("insert into cron.job_run_details (jobid, status) select jobid, 'succeeded' from cron.job where jobname = 'barberia-limpeza-midia'")
    await db.query("insert into public.outbox_events (barbershop_id, tipo, destino, dedup_key, status) select $1, 'reserva_confirmada', '5564992750733', 'baixo-' || g, 'falhou' from generate_series(1, 4) g", [loja])
    expect((await q("select private.verificar_alertas() as m"))[0].m).toBeNull()
    expect(await pedidos()).toHaveLength(0)
  })

  it("resumo diário: sem alerta nas 24 h avisa que está tudo certo (mostra que o alerta está vivo)", async () => {
    await segredos()
    const m = (await q("select private.verificar_alertas(true) as m"))[0].m
    expect(m).toContain("nenhum alerta")
    expect(await pedidos()).toHaveLength(1)
  })

  it("sem os segredos no Vault não chama nada e registra o motivo; o token nunca vai para o histórico", async () => {
    await db.exec("insert into auth.users (email) select 'robo-b' || g || '@example.test' from generate_series(1, 25) g")
    expect((await q("select private.verificar_alertas() as m"))[0].m).toContain("25 contas novas")
    expect(await pedidos()).toHaveLength(0)
    const [ultimo] = await q("select enviado, erro, mensagem from private.alertas_seguranca order by id desc limit 1")
    expect(ultimo).toMatchObject({ enviado: false, erro: "segredo_ausente_no_vault" })
    expect(JSON.stringify(await q("select * from private.alertas_seguranca"))).not.toContain(TOKEN)
  })

  it("a função e o histórico não são acessíveis pela API; os dois horários ficam agendados", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`)
      await expect(db.query("select private.verificar_alertas()")).rejects.toThrow(/permission denied/)
      await expect(db.query("select * from private.alertas_seguranca")).rejects.toThrow(/permission denied/)
      await db.exec("reset role")
    }
    const jobs = await q("select jobname, schedule, command from cron.job where jobname like 'barberia-alerta%' order by jobname")
    expect(jobs).toEqual([
      { jobname: "barberia-alerta-resumo", schedule: "0 12 * * *", command: "select private.verificar_alertas(true)" },
      { jobname: "barberia-alerta-seguranca", schedule: "5 * * * *", command: "select private.verificar_alertas()" },
    ])
  })
})
