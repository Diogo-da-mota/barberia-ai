/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Alerta de segurança no Telegram (0054 + ponte 0055) em PostgreSQL local (PGlite), com pg_cron, pg_net e Vault simulados.
// A ponte (Edge Function alerta-telegram) roda com o mesmo módulo de _shared e um Telegram falso. Nada toca o remoto.
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { enviarAlertasPendentes } from "../functions/_shared/alerta-telegram"
import type { Rpc } from "../functions/_shared/whatsapp-outbox"

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
const PONTE = "https://projeto.supabase.co/functions/v1/alerta-telegram"
const segredos = () => db.exec(`insert into vault.decrypted_secrets values ('barberia_telegram_token', '${TOKEN}'), ('barberia_telegram_chat_id', '987654'),
  ('barberia_media_migrate_url', 'https://projeto.supabase.co/functions/v1/media-migrate'), ('barberia_anon_key', 'chave-anon-publica') on conflict (name) do nothing`)
/** A Edge Function alerta-telegram (service_role): mesmo módulo, com o Telegram simulado. */
const rpc: Rpc = async (fn, args = {}) => {
  const nomes = Object.keys(args)
  await db.exec("set role service_role")
  try {
    return { data: (await q(`select ${fn}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, nomes.map((n) => args[n])))[0].r, error: null }
  } catch (err) {
    return { data: null, error: { message: (err as Error).message } }
  } finally {
    await db.exec("reset role")
  }
}
const telegram: { url: string; corpo: any }[] = []
let telegramFora = false
const fetchFalso = (async (url: string, init: { body: string }) => {
  if (telegramFora) throw new Error("connect timeout")
  telegram.push({ url, corpo: JSON.parse(init.body) })
  return new Response("{\"ok\":true}", { status: 200 })
}) as unknown as typeof fetch
const ponte = () => enviarAlertasPendentes(rpc, fetchFalso)

beforeAll(async () => {
  await db.exec(AMBIENTE)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql") && x < "0051").sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  await db.exec(SIMULADOS)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql") && x >= "0051" && x < "0056").sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  const dono = (await q("insert into auth.users (email, created_at) values ('dono@example.test', now() - interval '3 days') returning id"))[0].id
  loja = (await q("insert into public.barbershops (owner_id, nome, slug) values ($1, 'Barbearia do Tico', 'barbearia-do-tico') returning id", [dono]))[0].id
}, 120_000)

afterAll(async () => { await db.close() })

beforeEach(async () => {
  await db.exec("delete from net.pedidos; delete from cron.job_run_details; delete from public.outbox_events; delete from vault.decrypted_secrets; delete from private.media_cleanup_runs; delete from private.alertas_seguranca;")
  telegram.length = 0
  telegramFora = false
  await db.exec("update auth.users set created_at = now() - interval '3 days'")
})

describe("alerta de segurança no Telegram (0054)", () => {
  it("sem nada estranho na última hora, não envia nada", async () => {
    await segredos()
    expect((await q("select private.verificar_alertas() as m"))[0].m).toBeNull()
    expect(await pedidos()).toHaveLength(0)
  })

  it("cadastro em massa (20 ou mais contas na última hora) guarda o alerta e chama a ponte, sem token nem texto no pedido", async () => {
    await segredos()
    await db.exec("insert into auth.users (email) select 'robo' || g || '@example.test' from generate_series(1, 20) g")
    const m = (await q("select private.verificar_alertas() as m"))[0].m
    expect(m).toContain("20 contas novas")
    const [p] = await q("select url, body, headers from net.pedidos")
    expect(p.url).toBe(PONTE)
    expect(p.headers).toMatchObject({ Authorization: "Bearer chave-anon-publica", apikey: "chave-anon-publica" })
    expect(JSON.stringify(p)).not.toContain(TOKEN)
    expect(JSON.stringify(p)).not.toContain("contas novas")
    expect(await q("select enviado from private.alertas_seguranca")).toEqual([{ enviado: false }])
  })

  it("a ponte manda os alertas pendentes ao Telegram com o token e o chat do Vault, uma vez só", async () => {
    await segredos()
    await db.exec("insert into auth.users (email) select 'robo-p' || g || '@example.test' from generate_series(1, 20) g")
    await q("select private.verificar_alertas()")
    expect(await ponte()).toEqual({ enviados: 1, falhas: 0 })
    expect(telegram).toHaveLength(1)
    expect(telegram[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(telegram[0].corpo).toMatchObject({ chat_id: "987654" })
    expect(telegram[0].corpo.text).toContain("20 contas novas")
    expect(await q("select enviado, erro from private.alertas_seguranca")).toEqual([{ enviado: true, erro: null }])
    expect(await ponte()).toEqual({ enviados: 0, falhas: 0 })
    expect(telegram).toHaveLength(1)
  })

  it("Telegram fora do ar: o alerta fica pendente com o motivo e sai na próxima chamada", async () => {
    await segredos()
    await q("select private.verificar_alertas(true)")
    telegramFora = true
    expect(await ponte()).toEqual({ enviados: 0, falhas: 1 })
    expect(await q("select enviado, erro from private.alertas_seguranca")).toEqual([{ enviado: false, erro: "telegram_indisponivel" }])
    telegramFora = false
    expect(await ponte()).toEqual({ enviados: 1, falhas: 0 })
    expect(telegram[0].corpo.text).toContain("nenhum alerta")
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
    expect((await pedidos())[0].url).toBe(PONTE)
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
    expect(await q("select tipo, enviado from private.alertas_seguranca")).toEqual([{ tipo: "resumo", enviado: false }])
  })

  it("sem o endereço da ponte no Vault não chama nada e registra o motivo", async () => {
    await db.exec("insert into auth.users (email) select 'robo-b' || g || '@example.test' from generate_series(1, 25) g")
    expect((await q("select private.verificar_alertas() as m"))[0].m).toContain("25 contas novas")
    expect(await pedidos()).toHaveLength(0)
    expect(await q("select enviado, erro from private.alertas_seguranca")).toEqual([{ enviado: false, erro: "url_ausente_no_vault" }])
  })

  it("sem o token do Telegram a ponte não envia nada, registra o motivo e o token nunca vai para o histórico", async () => {
    await db.exec("insert into vault.decrypted_secrets values ('barberia_media_migrate_url', 'https://projeto.supabase.co/functions/v1/media-migrate'), ('barberia_anon_key', 'chave-anon-publica')")
    await q("select private.verificar_alertas(true)")
    expect(await ponte()).toEqual({ enviados: 0, falhas: 1 })
    expect(telegram).toHaveLength(0)
    expect(await q("select enviado, erro from private.alertas_seguranca")).toEqual([{ enviado: false, erro: "segredo_ausente_no_vault" }])
    await segredos()
    await ponte()
    expect(JSON.stringify(await q("select * from private.alertas_seguranca"))).not.toContain(TOKEN)
  })

  it("a função e o histórico não são acessíveis pela API; os dois horários ficam agendados", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`)
      await expect(db.query("select private.verificar_alertas()")).rejects.toThrow(/permission denied/)
      await expect(db.query("select * from private.alertas_seguranca")).rejects.toThrow(/permission denied/)
      await expect(db.query("select alerta_telegram_pendentes()")).rejects.toThrow(/permission denied/)
      await expect(db.query("select alerta_telegram_resultado(1, true, null)")).rejects.toThrow(/permission denied/)
      await db.exec("reset role")
    }
    const jobs = await q("select jobname, schedule, command from cron.job where jobname like 'barberia-alerta%' order by jobname")
    expect(jobs).toEqual([
      { jobname: "barberia-alerta-resumo", schedule: "0 12 * * *", command: "select private.verificar_alertas(true)" },
      { jobname: "barberia-alerta-seguranca", schedule: "5 * * * *", command: "select private.verificar_alertas()" },
    ])
  })
})
