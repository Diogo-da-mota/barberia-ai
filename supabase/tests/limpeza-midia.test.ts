/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Limpeza diária dos envios órfãos do S3 (0050 + 0051) em PostgreSQL local (PGlite), com imagens fictícias, o S3 simulado e
// pg_cron, pg_net e Vault simulados. Nada aqui toca o banco remoto nem o S3.
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { limparOrfaos } from "../functions/_shared/media-cleanup"
import type { Rpc } from "../functions/_shared/whatsapp-outbox"

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
// pg_cron, pg_net e Vault simulados (mesmos nomes e parâmetros usados pela 0051)
const SIMULADOS = `
  create schema vault; create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
  create schema net;
  create table net.pedidos (id bigserial primary key, url text, body jsonb, headers jsonb, timeout_milliseconds integer);
  create table net._http_response (id bigint primary key, status_code integer, content text, timed_out boolean, error_msg text);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
    returns bigint language sql as $$ insert into net.pedidos (url, body, headers, timeout_milliseconds) values (url, body, headers, timeout_milliseconds) returning id $$;
  create schema cron; create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
    insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
`

const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1") }
const db = new PGlite({ extensions: { btree_gist } })
let loja = "", corte = "", ana = "", seq = 0
const antes = { cadastroAceito: false, arquivoApagadoEmUso: false }
const key = (folder: string) => `BARBEARIA/${loja}/${folder}/00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}.jpg`

async function como(user: string, q: string, p: unknown[] = []) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user])
  await db.exec("set role authenticated")
  try { return (await db.query<Record<string, any>>(q, p)).rows } finally { await db.exec("reset role") }
}
const sql = async (q: string, p: unknown[] = []) => (await db.query<Record<string, any>>(q, p)).rows
/** A função media anota o envio antes de gravar no S3; o S3 simulado guarda o arquivo. */
const s3 = new Set<string>()
async function enviar(folder: string, horasAtras = 25) {
  const k = key(folder)
  await sql("select reserve_media_upload($1, $2, $3)", [loja, k, ID.dono])
  await sql("update media_uploads set criado_em = now() - make_interval(hours => $2::int) where key = $1", [k, horasAtras])
  s3.add(k)
  return k
}
// Cadastros feitos pela gestão (mesmas funções do app)
const cadastrar = {
  logo: (k: string) => como(ID.dono, "select register_media($1, 'logo', $2, 1000)", [loja, k]),
  galeria: (k: string) => como(ID.dono, "select register_media($1, 'galeria', $2, 1000)", [loja, k]),
  servico: (k: string) => como(ID.dono, "select set_service_image($1, $2)", [corte, k]),
  fotoServico: (k: string) => como(ID.dono, "select add_service_photo($1, $2)", [corte, k]),
  profissional: (k: string) => como(ID.dono, "select set_professional_avatar($1, $2)", [ana, k]),
}
/** A Edge Function media-migrate (service_role): mesmo módulo de limpeza, com o S3 simulado. */
const rpc: Rpc = async (fn, args = {}) => {
  const nomes = Object.keys(args)
  try {
    return { data: await sql(`select * from ${fn}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(", ")})`, nomes.map((n) => args[n])), error: null }
  } catch (err) {
    return { data: null, error: { message: (err as Error).message } }
  }
}
const falhar = new Set<string>()
const apagar = async (k: string) => { if (falhar.has(k)) throw new Error("s3_indisponivel"); s3.delete(k) }
const limpar = () => limparOrfaos(rpc, apagar)

beforeAll(async () => {
  await db.exec(AMBIENTE)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql") && x < "0050").sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'dono@example.test', '{}')", [ID.dono])
  loja = (await como(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a') id"))[0].id
  corte = (await como(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [loja]))[0].id
  ana = (await como(ID.dono, "select save_professional($1, null, 'Ana', true, $2) id", [loja, [corte]]))[0].id

  // Antes da 0050: a lista não reserva nada; um cadastro entre a lista e a exclusão é aceito e a imagem fica sem arquivo.
  const k = await enviar("site/galeria")
  const lista = (await sql("select key from list_orphan_media(100)")).map((r) => r.key)
  if (lista.includes(k)) {
    try { await cadastrar.galeria(k); antes.cadastroAceito = true } catch { antes.cadastroAceito = false }
    await apagar(k)
    await sql("select mark_media_removed($1)", [[k]])
    antes.arquivoApagadoEmUso = !s3.has(k) && (await sql("select 1 from media_objects where storage_path = $1", [k])).length === 1
  }
  await db.exec(readFileSync("supabase/migrations/0050_midia_limpeza_reserva.sql", "utf8"))
  await db.exec(SIMULADOS)
  await db.exec(readFileSync("supabase/migrations/0051_midia_limpeza_agendada.sql", "utf8"))
}, 120_000)

afterAll(async () => {
  await db.close()
})

describe("limpeza dos órfãos sem corrida com o cadastro (0050)", () => {
  it("antes da 0050: cadastro entre a lista e a exclusão era aceito e a imagem ficava cadastrada sem arquivo", () => {
    expect(antes).toEqual({ cadastroAceito: true, arquivoApagadoEmUso: true })
  })

  it("logo, galeria, serviço, galeria do serviço e profissional cadastrados, envio em andamento e imagem antiga nunca são apagados", async () => {
    const usados = { logo: await enviar("site/logo"), galeria: await enviar("site/galeria"), servico: await enviar(`servicos/${corte}`),
      fotoServico: await enviar(`servicos/${corte}`), profissional: await enviar(`profissionais/${ana}`) }
    for (const [tipo, k] of Object.entries(usados)) await cadastrar[tipo as keyof typeof cadastrar](k)
    const emAndamento = await enviar("site/galeria", 1) // enviado há 1 h, cadastro ainda não chegou
    const antiga = key("site/capa") // imagem anterior à 0041 (sem anotação): em uso e no S3
    await sql("insert into media_objects (barbershop_id, kind, storage_path, mime, tamanho_bytes) values ($1, 'capa', $2, 'image/jpeg', 1000)", [loja, antiga])
    s3.add(antiga)
    const desconhecida = key("site/galeria") // arquivo no S3 sem anotação nem cadastro: a limpeza não sabe dele
    s3.add(desconhecida)
    const orfas = [await enviar("site/galeria"), await enviar(`servicos/${corte}`)]

    expect(await limpar()).toEqual({ encontrados: 2, apagados: 2, falhas: 0 })
    for (const k of orfas) expect(s3.has(k)).toBe(false)
    for (const k of [...Object.values(usados), emAndamento, antiga, desconhecida]) expect(s3.has(k)).toBe(true)
    await cadastrar.galeria(emAndamento) // o cadastro do envio em andamento chega depois da limpeza e é aceito
    expect(await limpar()).toEqual({ encontrados: 0, apagados: 0, falhas: 0 })
  })

  it("arquivo reservado pela limpeza não pode mais ser cadastrado em nenhuma das 4 tabelas", async () => {
    const ks = { galeria: await enviar("site/galeria"), servico: await enviar(`servicos/${corte}`),
      fotoServico: await enviar(`servicos/${corte}`), profissional: await enviar(`profissionais/${ana}`) }
    const reservados = (await sql("select key from list_orphan_media(100)")).map((r) => r.key)
    expect(new Set(reservados)).toEqual(new Set(Object.values(ks)))
    for (const [tipo, k] of Object.entries(ks)) await expect(cadastrar[tipo as keyof typeof cadastrar](k)).rejects.toThrow(/media_removed/)
    await sql("select mark_media_removed($1)", [reservados])
    await expect(cadastrar.galeria(ks.galeria)).rejects.toThrow(/media_removed/) // removido também é recusado
  })

  it("cadastro que chega antes da reserva vence: o arquivo sai da lista e fica no S3", async () => {
    const k = await enviar("site/galeria")
    await cadastrar.galeria(k)
    expect((await sql("select key from list_orphan_media(100)")).map((r) => r.key)).not.toContain(k)
    expect(s3.has(k)).toBe(true)
  })

  it("falha no S3: o arquivo fica reservado (e bloqueado para cadastro) e volta a ser candidato depois de 1 h", async () => {
    const k = await enviar("site/galeria")
    falhar.add(k)
    expect(await limpar()).toEqual({ encontrados: 1, apagados: 0, falhas: 1 })
    falhar.delete(k)
    expect(await limpar()).toEqual({ encontrados: 0, apagados: 0, falhas: 0 }) // reserva recente: não repete na mesma hora
    await sql("update media_uploads set limpeza_em = now() - interval '2 hours' where key = $1", [k])
    expect(await limpar()).toEqual({ encontrados: 1, apagados: 1, falhas: 0 })
    expect((await sql("select removido_em is not null r from media_uploads where key = $1", [k]))[0].r).toBe(true)
  })

  it("só o servidor reserva e lista; a gestão não chama a limpeza", async () => {
    await expect(como(ID.dono, "select * from list_orphan_media(10)")).rejects.toThrow(/permission denied/)
    await expect(como(ID.dono, "select private.media_guard_register()")).rejects.toThrow(/permission denied|trigger functions/)
  })
})

describe("agendamento diário pelo Supabase Cron (0051)", () => {
  const segredos = { barberia_media_migrate_url: "https://projeto.example.test/functions/v1/media-migrate", barberia_anon_key: "anon-ficticia", barberia_media_migrate_secret: "segredo-ficticio-da-limpeza" }
  const ultima = async () => (await sql("select * from private.media_cleanup_runs order by id desc limit 1"))[0]

  it("cria os dois agendamentos às 06:00 e 06:20 UTC (03:00 e 03:20 em Brasília)", async () => {
    expect(await sql("select jobname, schedule, command from cron.job order by jobname")).toEqual([
      { jobname: "barberia-limpeza-midia", schedule: "0 6 * * *", command: "select private.start_media_cleanup()" },
      { jobname: "barberia-limpeza-midia-resultado", schedule: "20 6 * * *", command: "select private.collect_media_cleanup()" },
    ])
  })

  it("sem os segredos no Vault não chama nada e registra o motivo", async () => {
    expect((await sql("select private.start_media_cleanup() r"))[0].r).toBeNull()
    expect(await sql("select count(*)::int n from net.pedidos")).toEqual([{ n: 0 }])
    expect(await ultima()).toMatchObject({ erro: "segredo_ausente_no_vault", request_id: null })
  })

  it("com os segredos: POST limpar-orfaos com a chave anon e o segredo da função; o histórico não guarda segredo", async () => {
    for (const [nome, valor] of Object.entries(segredos)) await sql("insert into vault.decrypted_secrets values ($1, $2)", [nome, valor])
    const req = Number((await sql("select private.start_media_cleanup() r"))[0].r)
    const [pedido] = await sql("select url, body, headers from net.pedidos where id = $1", [req])
    expect(pedido.url).toBe(segredos.barberia_media_migrate_url)
    expect(pedido.body).toEqual({ acao: "limpar-orfaos" })
    expect(pedido.headers).toMatchObject({ Authorization: "Bearer anon-ficticia", "x-migrate-secret": "segredo-ficticio-da-limpeza" })
    expect(JSON.stringify(await sql("select * from private.media_cleanup_runs"))).not.toMatch(/segredo-ficticio|anon-ficticia/)

    await sql("insert into net._http_response (id, status_code, content, timed_out) values ($1, 200, '{\"encontrados\":3,\"apagados\":2,\"falhas\":1}', false)", [req])
    expect((await sql("select private.collect_media_cleanup() n"))[0].n).toBe(1)
    expect(await ultima()).toMatchObject({ request_id: req, status_http: 200, encontrados: 3, apagados: 2, falhas: 1, erro: null })
  })

  it("registra erro curto: recusa (403), falha sem JSON (500), tempo esgotado e sem resposta; pedido recente fica aguardando", async () => {
    const casos: [number | null, string | null, boolean, string][] = [
      [403, '{"error":"forbidden"}', false, "forbidden"], [500, "<html>erro</html>", false, "http_500"], [null, null, true, "tempo_esgotado"],
    ]
    for (const [status, content, timedOut, erro] of casos) {
      const req = Number((await sql("select private.start_media_cleanup() r"))[0].r)
      await sql("insert into net._http_response (id, status_code, content, timed_out) values ($1, $2, $3, $4)", [req, status, content, timedOut])
      await sql("select private.collect_media_cleanup()")
      expect(await ultima()).toMatchObject({ request_id: req, erro })
    }
    const req = Number((await sql("select private.start_media_cleanup() r"))[0].r)
    await sql("select private.collect_media_cleanup()")
    expect(await ultima()).toMatchObject({ request_id: req, concluido_em: null })
    await sql("update private.media_cleanup_runs set iniciado_em = now() - interval '6 hours' where request_id = $1", [req])
    await sql("select private.collect_media_cleanup()")
    expect(await ultima()).toMatchObject({ request_id: req, erro: "sem_resposta" })
  })

  it("a gestão e o visitante não executam as funções nem leem o histórico", async () => {
    for (const q of ["select private.start_media_cleanup()", "select private.collect_media_cleanup()", "select * from private.media_cleanup_runs"]) {
      await expect(como(ID.dono, q)).rejects.toThrow(/permission denied/)
    }
  })
})
