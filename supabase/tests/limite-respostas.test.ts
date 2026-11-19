/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Limite de respostas do WhatsApp (P3): antes da 0046 o teto de 300 por minuto era um contador único da plataforma, então as
// mensagens recebidas por uma barbearia faziam o sistema recusar as respostas dos clientes das outras. Agora cada barbearia
// tem a sua cota (120/min), o caminho sem barbearia (Cloud API) tem a dele e um teto geral de 1200/min protege o endpoint.
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

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
`
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { donoA: U("a1"), donoB: U("a2") }
let db: PGlite
const loja = { A: "", B: "" }
let evento = 0
let antes: string | null = null

/** O que o evolution-webhook faz: process_whatsapp_reply como servidor, com a barbearia da instância (ou null, Cloud API). */
async function receber(shop: string | null, texto = "oi", from = "5564992750733") {
  try {
    const [r] = (await db.query<Record<string, any>>("select process_whatsapp_reply($1, now(), $2, null, $3, $4) r", [`ev-${++evento}`, from, texto, shop])).rows
    return r.r as string
  } catch (err) {
    return (err as Error).message
  }
}
async function rajada(shop: string | null, n: number) {
  for (let i = 0; i < n; i++) await receber(shop)
}

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } })
  await db.exec(AMBIENTE)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql") && x < "0046").sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  for (const [chave, dono] of [["A", ID.donoA], ["B", ID.donoB]] as const) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [dono])
    await db.exec("set role authenticated")
    loja[chave] = (await db.query<{ id: string }>(`select create_barbershop('Barbearia ${chave}', 'barbearia-${chave.toLowerCase()}') id`)).rows[0].id
    await db.exec("reset role")
  }

  // Antes da 0046: 300 mensagens recebidas pela instância de B no último minuto derrubam a resposta de um cliente de A.
  await rajada(loja.B, 300)
  antes = await receber(loja.A, "sim")
  await db.query("delete from inbound_webhook_events")
  await db.exec(readFileSync("supabase/migrations/0046_limite_respostas_por_barbearia.sql", "utf8"))
}, 180_000)

afterAll(async () => {
  await db.close()
})

describe("limite de respostas do WhatsApp por barbearia (0046)", () => {
  it("antes da 0046, o volume de B fazia a resposta do cliente de A ser recusada", () => {
    expect(antes).toBe("rate_limited")
  })

  it("depois: B esgota só a própria cota (120/min); A e o caminho sem barbearia continuam respondendo", async () => {
    await rajada(loja.B, 120)
    expect(await receber(loja.B)).toBe("rate_limited")
    expect(await receber(loja.A, "sim")).not.toBe("rate_limited")
    expect(await receber(null, "sim")).not.toBe("rate_limited")
    const [b] = (await db.query<{ n: number }>("select count(*)::int n from inbound_webhook_events where origem_barbershop_id = $1", [loja.B])).rows
    expect(b.n).toBe(120) // a mensagem recusada não grava nada
  })

  it("a proteção geral contra abuso continua: teto de 1200 por minuto somando tudo, e 300 para o caminho sem barbearia", async () => {
    await db.query("insert into inbound_webhook_events (provider, event_id, recebido_em, origem_barbershop_id) select 'whatsapp', 'carga-' || g, now(), null from generate_series(1, 300) g")
    expect(await receber(null)).toBe("rate_limited")
    expect(await receber(loja.A)).not.toBe("rate_limited")
    await db.query("insert into inbound_webhook_events (provider, event_id, recebido_em, origem_barbershop_id) select 'whatsapp', 'geral-' || g, now(), $1 from generate_series(1, 800) g", [loja.B])
    expect(await receber(loja.A)).toBe("rate_limited")
  })

  it("a coluna barbershop_id (lida pela Central de Mensagens) não muda: texto sem resposta continua sem barbearia", async () => {
    await db.query("delete from inbound_webhook_events")
    await receber(loja.A, "oi, tudo bem?")
    const [linha] = (await db.query<Record<string, any>>("select barbershop_id, origem_barbershop_id, status from inbound_webhook_events")).rows
    expect(linha).toEqual({ barbershop_id: null, origem_barbershop_id: loja.A, status: "ignorado" })
  })
})
