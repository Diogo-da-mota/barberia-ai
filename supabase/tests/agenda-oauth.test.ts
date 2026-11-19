/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Vínculo do Google Agenda (P1, migration 0047 + _shared/calendar-oauth.ts). Handler real da função google-calendar-oauth com
// banco local (PGlite, todas as migrations), sessão e Google simulados (o Google simulado confere o PKCE como o real).
// Antes da correção, o link de início de um barbeiro aberto por outra pessoa ligava a conta Google dela ao profissional dele
// (reproduzido em ~/security-audit-skill/barberia-ai/run-2/agents/p1-antes/scratch/evidence/antes.out.txt).
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createPkcePair, pkceChallenge } from "../functions/_shared/calendar"
import { GCAL_SCOPE, handleCalendarOAuth, type CalendarOAuthDeps } from "../functions/_shared/calendar-oauth"

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
const ID = { dono: U("a1"), rafael: U("b1"), carla: U("b2") }
const FUNCAO = "https://projeto.example.test/functions/v1/google-calendar-oauth"
const JWT: Record<string, string> = { "jwt-rafael": ID.rafael, "jwt-carla": ID.carla }
let db: PGlite
let loja = ""
const card: Record<"rafael" | "carla", string> = { rafael: "", carla: "" }

async function como(user: string, q: string, p: unknown[] = []) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user])
  await db.exec("set role authenticated")
  try { return (await db.query<Record<string, any>>(q, p)).rows } finally { await db.exec("reset role") }
}

// Google simulado: consentimento devolve um código preso ao code_challenge; o token exige o verificador certo.
const consentidos = new Map<string, { challenge: string; conta: string }>()
let chamadasAoToken = 0
function consentir(inicio: string, conta: string): string {
  const auth = new URL(inicio)
  const code = `code-${conta}-${consentidos.size + 1}`
  consentidos.set(code, { challenge: auth.searchParams.get("code_challenge")!, conta })
  return `${FUNCAO}?code=${code}&state=${encodeURIComponent(auth.searchParams.get("state")!)}`
}
const deps: CalendarOAuthDeps = {
  env: (n) => ({ APP_URL: "https://app.example.test", SUPABASE_URL: "https://projeto.example.test", GOOGLE_CLIENT_ID: "cliente", GOOGLE_CLIENT_SECRET: "segredo" })[n],
  rpc: async (fn, args) => {
    const nomes = Object.keys(args)
    try {
      const r = await db.query<Record<string, any>>(`select ${fn}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(", ")}) r`, nomes.map((n) => args[n]))
      return { data: r.rows[0]?.r ?? null, error: null }
    } catch (err) {
      return { data: null, error: { message: (err as Error).message } }
    }
  },
  userId: async (jwt) => JWT[jwt] ?? null,
  professionalOf: async (id) => (await db.query<{ p: string }>("select professional_id p from calendar_connections where id = $1", [id])).rows[0]?.p ?? null,
  fetch: (async (_url: string, init: RequestInit) => {
    chamadasAoToken++
    const corpo = new URLSearchParams(String(init.body))
    const c = consentidos.get(corpo.get("code") ?? "")
    if (!c || (await pkceChallenge(corpo.get("code_verifier") ?? "")) !== c.challenge) return new Response('{"error":"invalid_grant"}', { status: 400 })
    return new Response(JSON.stringify({ refresh_token: `rt-google-${c.conta}`, scope: GCAL_SCOPE }), { status: 200 })
  }) as typeof fetch,
}
const get = (url: string) => handleCalendarOAuth(new Request(url), deps)
const post = (jwt: string | null, body: unknown) =>
  handleCalendarOAuth(new Request(FUNCAO, { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }), deps)
const conexao = async (prof: string) => ({
  status: (await db.query<{ s: string }>("select status s from calendar_connections where professional_id = $1", [prof])).rows[0]?.s ?? null,
  token: (await db.query<{ t: string }>("select refresh_token t from calendar_credentials where professional_id = $1", [prof])).rows[0]?.t ?? null,
})
/** O app: state do próprio profissional + par PKCE guardado no navegador de quem iniciou. */
async function iniciar(quem: "rafael" | "carla") {
  const [{ s }] = await como(ID[quem], "select start_calendar_link($1) s", [card[quem]])
  const pkce = await createPkcePair()
  return { state: s as string, ...pkce, inicio: `${FUNCAO}?state=${encodeURIComponent(s)}&code_challenge=${pkce.challenge}` }
}
const retornoNoApp = (location: string) => new URLSearchParams(new URL(location).hash.slice(1))

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } })
  await db.exec(AMBIENTE)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  loja = (await como(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a') id"))[0].id
  await db.query("update subscriptions set plan_id = 'rede' where barbershop_id = $1", [loja])
  for (const quem of ["rafael", "carla"] as const) {
    const [{ t }] = await como(ID.dono, "select create_invite($1, $2, 'barbeiro') t", [loja, `${quem}@example.test`])
    await como(ID[quem], "select accept_invite($1)", [t])
    card[quem] = (await db.query<{ id: string }>("select id from professionals where profile_id = $1", [ID[quem]])).rows[0].id
  }
}, 180_000)

afterAll(async () => {
  await db.close()
})

describe("vínculo do Google Agenda preso à sessão de quem iniciou (0047)", () => {
  it("fluxo legítimo: início sem cookie, retorno volta ao app e o POST com a sessão do dono conclui o vínculo", async () => {
    const r = await iniciar("rafael")
    const inicio = await get(r.inicio)
    expect(inicio.status).toBe(302)
    expect(inicio.headers.get("set-cookie")).toBeNull()
    const google = new URL(inicio.headers.get("location")!)
    expect([google.host, google.searchParams.get("code_challenge"), google.searchParams.get("scope")]).toEqual(["accounts.google.com", r.challenge, GCAL_SCOPE])

    const retorno = await get(consentir(inicio.headers.get("location")!, "rafael"))
    expect(retorno.headers.get("location")!.startsWith("https://app.example.test/mais?calendario=retorno#")).toBe(true)
    const p = retornoNoApp(retorno.headers.get("location")!)
    expect(await conexao(card.rafael)).toEqual({ status: "aguardando_consentimento", token: null }) // o retorno sozinho não conclui

    const fim = await post("jwt-rafael", { code: p.get("gcal_code"), state: p.get("gcal_state"), code_verifier: r.verifier })
    expect([fim.status, await fim.json()]).toEqual([200, { ok: true }])
    expect(await conexao(card.rafael)).toEqual({ status: "ativo", token: "rt-google-rafael" })
  })

  it("ataque: o link de início do Rafael aberto pela Carla não liga a conta Google dela ao profissional dele", async () => {
    await como(ID.rafael, "select unlink_calendar($1)", [card.rafael])
    const r = await iniciar("rafael") // o atacante guarda o verificador e manda só o link à Carla
    const inicioNaCarla = await get(r.inicio)
    const retornoNaCarla = await get(consentir(inicioNaCarla.headers.get("location")!, "carla"))
    const p = retornoNaCarla.headers.get("location")!
    expect(p).toContain("calendario=retorno#gcal_code=") // o código fica no navegador da Carla, que não tem o verificador
    const code = retornoNoApp(p).get("gcal_code")
    const antes = chamadasAoToken

    // o app da Carla (com a sessão dela) não é dono do state; sem sessão nem chega a conferir
    expect((await post("jwt-carla", { code, state: r.state, code_verifier: (await createPkcePair()).verifier })).status).toBe(403)
    expect((await post(null, { code, state: r.state, code_verifier: r.verifier })).status).toBe(401)
    expect(chamadasAoToken).toBe(antes) // o código da Carla nunca foi trocado
    expect(await conexao(card.rafael)).toEqual({ status: "aguardando_consentimento", token: null })
    expect(await conexao(card.carla)).toEqual({ status: null, token: null })
  })

  it("state vencido, de card desativado ou de outra barbearia não conclui; pedido malformado é recusado", async () => {
    const r = await iniciar("carla")
    await db.query("update calendar_connections set state_expira_em = now() - interval '1 minute' where professional_id = $1", [card.carla])
    expect((await post("jwt-carla", { code: "x", state: r.state, code_verifier: r.verifier })).status).toBe(403)
    const r2 = await iniciar("carla")
    await como(ID.dono, "select save_professional($1, $2, 'carla', false, '{}')", [loja, card.carla])
    expect((await post("jwt-carla", { code: "x", state: r2.state, code_verifier: r2.verifier })).status).toBe(403)
    expect((await post("jwt-carla", { code: "x", state: r2.state, code_verifier: "curto" })).status).toBe(400)
    expect((await get(`${FUNCAO}?state=abc`)).status).toBe(400) // sem code_challenge válido
    expect((await get(`${FUNCAO}?error=access_denied&state=abc`)).headers.get("location")).toBe("https://app.example.test/mais?calendario=erro")
  })

  it("a conferência do dono é só do servidor", async () => {
    for (const u of [ID.rafael, ID.dono]) await expect(como(u, "select calendar_state_owner('x')")).rejects.toThrow(/permission denied/)
  })
})
