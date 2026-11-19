/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Fila do WhatsApp (P2): linha que fica 'enviando' sem o worker registrar o resultado. Antes da 0044 ela voltava sem teto
// e sempre na frente da fila global, e um lote de linhas assim de uma barbearia impedia as outras de serem reivindicadas.
// Simulação: o worker "morre" depois de reivindicar (não chama complete_outbox) e o relógio da fila avança 11 minutos.
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { processarConfirmacoesELembretes, type Rpc } from "../functions/_shared/whatsapp-outbox"

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
const loja: Record<"A" | "B", string> = { A: "", B: "" }
let seq = 0
let antes: { b_reivindicada: boolean; maior_tentativa: number; falhou: number } | null = null

const sql = async (q: string, p: unknown[] = []) => (await db.query<Record<string, any>>(q, p)).rows
async function comoDono(user: string, q: string, p: unknown[] = []) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user])
  await db.exec("set role authenticated")
  try { return await sql(q, p) } finally { await db.exec("reset role") }
}
/** Enfileira N confirmações pendentes (números distintos, para o limite por número não interferir). */
async function enfileirar(shop: string, n: number, minutosAtras: number) {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const [r] = await sql("insert into outbox_events (barbershop_id, tipo, destino, payload, dedup_key, proximo_envio) values ($1, 'reserva_confirmada', $2, '{}', $3, now() - make_interval(mins => $4::int)) returning id",
      [shop, `6499${String(++seq).padStart(7, "0")}`, `teste-${seq}`, minutosAtras])
    ids.push(r.id)
  }
  return ids
}
const reivindicar = async () => (await sql("select id, barbershop_id from claim_whatsapp_outbox(20)")).map((r) => r.id as string)
/** O worker morreu: nada foi registrado; o relógio da fila anda 11 minutos para as linhas 'enviando'. */
const passar11min = () => sql("update outbox_events set atualizado_em = now() - interval '11 minutes' where status = 'enviando'")
async function ciclos(n: number, alvo: string) {
  let alvoSaiu = false
  for (let i = 0; i < n; i++) {
    if ((await reivindicar()).includes(alvo)) alvoSaiu = true
    await passar11min()
  }
  return alvoSaiu
}

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } })
  await db.exec(AMBIENTE)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql") && x < "0044").sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  for (const [chave, dono] of [["A", ID.donoA], ["B", ID.donoB]] as const) {
    loja[chave] = (await comoDono(dono, `select create_barbershop('Barbearia ${chave}', 'barbearia-${chave.toLowerCase()}') id`))[0].id
    await sql("insert into integration_accounts (barbershop_id, provider, status, evolution_instance_name) values ($1, 'whatsapp', 'ativo', $2)", [loja[chave], `inst_${chave}`])
  }

  // Antes da 0044: 40 linhas presas de A (mais antigas) e 1 confirmação de B; o worker nunca conclui.
  await enfileirar(loja.A, 40, 30)
  const [b] = await enfileirar(loja.B, 1, 0)
  const saiu = await ciclos(8, b)
  const [t] = await sql("select max(tentativas)::int m, count(*) filter (where status = 'falhou')::int f from outbox_events where barbershop_id = $1", [loja.A])
  antes = { b_reivindicada: saiu, maior_tentativa: t.m, falhou: t.f }
  await sql("delete from outbox_events")
  await db.exec(readFileSync("supabase/migrations/0044_fila_teto_tentativas.sql", "utf8"))
}, 180_000)

afterAll(async () => {
  await db.close()
})

describe("fila do WhatsApp: teto de tentativas e recuo para linha presa (0044)", () => {
  it("antes da 0044: as linhas presas de A passavam do teto (5) sem falhar e a confirmação de B nunca era reivindicada", () => {
    expect(antes).toEqual({ b_reivindicada: false, maior_tentativa: 8, falhou: 0 })
  })

  it("depois: a linha presa volta com recuo (não passa na frente) e a confirmação da outra barbearia sai no ciclo seguinte", async () => {
    const presas = await enfileirar(loja.A, 40, 30)
    const [b] = await enfileirar(loja.B, 1, 0)
    expect((await reivindicar()).every((id) => presas.includes(id))).toBe(true) // 1º lote: as 20 mais antigas de A
    await passar11min()
    const segundo = await reivindicar() // as 20 reapanhadas ficaram para depois: vêm as outras 20 de A
    expect(segundo.every((id) => presas.includes(id))).toBe(true)
    await passar11min()
    expect(await reivindicar()).toContain(b)
    const [linha] = await sql("select status, proximo_envio > now() adiada from outbox_events where id = $1", [presas[0]])
    expect(linha).toEqual({ status: "pendente", adiada: true })
  })

  it("passou de max_tentativas sem resultado: vira 'falhou' e sai da fila de vez", async () => {
    const [x] = await enfileirar(loja.A, 1, 30)
    for (let i = 0; i < 7; i++) {
      await sql("update outbox_events set proximo_envio = now() - interval '1 minute' where id = $1 and status = 'pendente'", [x])
      await reivindicar()
      await passar11min()
      await reivindicar() // roda manter_fila (devolve ou encerra a linha presa)
    }
    expect((await sql("select status, tentativas, ultimo_erro from outbox_events where id = $1", [x]))[0]).toEqual({ status: "falhou", tentativas: 5, ultimo_erro: "sem_resultado_do_envio" })
  })

  it("o worker corta o erro por caractere: um emoji no limite não vira texto inválido para o banco", async () => {
    const chamadas: Record<string, unknown>[] = []
    const rpc: Rpc = async (fn, args = {}) => {
      if (fn === "claim_whatsapp_outbox") return { data: [{ id: "e1", barbershop_id: loja.A, tipo: "reserva_confirmada", destino: "64992750733", payload: {}, instancia: "inst_A", modelo: null }], error: null }
      if (fn === "complete_outbox") chamadas.push(args)
      return { data: 0, error: null }
    }
    const r = await processarConfirmacoesELembretes(rpc, async () => { throw new Error(`${"x".repeat(299)}😀 falha`) })
    expect(r).toMatchObject({ recebidos: 1, enviados: 0, falhas: 1 })
    const erro = chamadas[0].p_erro as string
    expect(Array.from(erro)).toHaveLength(300)
    expect(erro.endsWith("😀")).toBe(true)
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(erro)).toBe(false)
  })

  it("metade de emoji já partida no erro do provedor vira U+FFFD (o banco aceita o registro)", async () => {
    const chamadas: Record<string, unknown>[] = []
    const rpc: Rpc = async (fn, args = {}) => {
      if (fn === "claim_whatsapp_outbox") return { data: [{ id: "e2", barbershop_id: loja.A, tipo: "reserva_confirmada", destino: "64992750733", payload: {}, instancia: "inst_A", modelo: null }], error: null }
      if (fn === "complete_outbox") chamadas.push(args)
      return { data: 0, error: null }
    }
    await processarConfirmacoesELembretes(rpc, async () => { throw new Error(`evolution 500: ${"😀".slice(0, 1)} fim`) })
    expect(chamadas[0].p_erro).toBe("evolution 500: \uFFFD fim")
    await expect(sql("select $1::text t", [chamadas[0].p_erro])).resolves.toHaveLength(1)
  })

  it("linha presa com muitas tentativas (deixada pelo recuo antigo) não estoura o recuo nem para a fila das outras barbearias", async () => {
    const [velha] = await enfileirar(loja.A, 1, 30)
    await sql("update outbox_events set status = 'enviando', tentativas = 40, atualizado_em = now() - interval '11 minutes' where id = $1", [velha])
    const [nova] = await enfileirar(loja.B, 1, 1)
    expect(await reivindicar()).toContain(nova)
    expect((await sql("select status, ultimo_erro from outbox_events where id = $1", [velha]))[0]).toEqual({ status: "falhou", ultimo_erro: "sem_resultado_do_envio" })
  })
})
