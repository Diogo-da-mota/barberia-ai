/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Planos e assinaturas SaaS (F11-01, F11-03 lado banco, F11-04, F11-05; T03, T13) em PostgreSQL local (PGlite).
// Não há cobrança real: o provedor de pagamento ainda não foi escolhido (bloqueio F11-02).
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite({ extensions: { btree_gist } })
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), donoB: U("b1"), cli: U("d1"), multi: U("e1") }
let loja = "", lojaB = "", corte = ""

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
const prof = (user: string, nome: string, ativo = true, shop = loja) =>
  val(user, "select save_professional($1, null, $2, $3, $4)", [shop, nome, ativo, [corte]])
const evento = (id: string, tipo: string, extra: { plano?: string | null; fim?: string | null; ts?: string; shop?: string } = {}) =>
  svcVal("select apply_billing_event('provedor-x', $1, $2, $3, $4, $5::timestamptz, $6::timestamptz)", [
    id, extra.shop ?? loja, tipo, extra.plano ?? null, extra.fim ?? null, extra.ts ?? new Date().toISOString(),
  ])

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    grant usage on schema public to service_role;
  `)
  for (const f of ["0001_identidade_inicial", "0002_catalogo", "0003_agenda", "0004_barbeiro", "0008_planos"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  loja = await val(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")
  lojaB = await val(ID.donoB, "select create_barbershop('Barbearia B', 'barbearia-b')")
  corte = (await rows(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [loja]))[0].id
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("F11-01: catálogo de planos e período de teste", () => {
  it("o catálogo é público; preços ainda não definidos e planos não comercializáveis", async () => {
    const planos = await rows(null, "select id, max_profissionais, trial_dias, preco_mensal_centavos, comercial from plans order by ordem")
    expect(planos.map((p) => p.id)).toEqual(["inicial", "profissional", "rede"])
    expect(planos.map((p) => p.max_profissionais)).toEqual([2, 6, null])
    expect(planos.every((p) => p.preco_mensal_centavos === null && p.comercial === false)).toBe(true)
    await expect(rows(ID.dono, "update plans set max_profissionais = 999")).rejects.toThrow(/permission denied/)
  })

  it("toda barbearia nova começa em teste no plano inicial", async () => {
    const [s] = await rows(ID.dono, "select plan_id, status, trial_ate > now() as no_prazo from subscriptions where barbershop_id = $1", [loja])
    expect(s).toMatchObject({ plan_id: "inicial", status: "trial", no_prazo: true })
  })

  it("assinatura só é visível à gestão da própria empresa e não é gravável pelo cliente (T03)", async () => {
    expect(await rows(ID.donoB, "select 1 from subscriptions where barbershop_id = $1", [loja])).toHaveLength(0)
    expect(await rows(ID.cli, "select 1 from subscriptions")).toHaveLength(0)
    await expect(rows(ID.dono, "update subscriptions set plan_id = 'rede', status = 'ativa'")).rejects.toThrow(/permission denied/)
    await expect(rows(ID.dono, "insert into subscriptions (barbershop_id, plan_id, status) values ($1, 'rede', 'ativa')", [lojaB])).rejects.toThrow(/permission denied/)
  })
})

describe("F11-05: limites medidos no servidor", () => {
  it("o plano inicial aceita 2 profissionais ativos; o terceiro é recusado", async () => {
    await prof(ID.dono, "Ana")
    await prof(ID.dono, "Bia")
    await expect(prof(ID.dono, "Caio")).rejects.toThrow(/plan_limit/)
  })

  it("inativar libera vaga; reativar acima do limite é recusado; contornar por update direto é impossível", async () => {
    const [{ id }] = await rows(ID.dono, "select id from professionals where nome = 'Bia'")
    await val(ID.dono, "select save_professional($1, $2, 'Bia', false, $3)", [loja, id, [corte]])
    await prof(ID.dono, "Caio")
    await expect(val(ID.dono, "select save_professional($1, $2, 'Bia', true, $3)", [loja, id, [corte]])).rejects.toThrow(/plan_limit/)
    await expect(sql("update professionals set ativo = true where id = $1", [id])).rejects.toThrow(/plan_limit/) // nem como superusuário: é gatilho
    await expect(rows(ID.dono, "update professionals set ativo = true where id = $1", [id])).rejects.toThrow(/permission denied/)
  })

  it("o uso do plano é consultável pela gestão", async () => {
    const [u] = await rows(ID.dono, "select * from get_plan_usage($1)", [loja])
    expect(u).toMatchObject({ plano: "inicial", status: "trial", max_profissionais: 2, profissionais_ativos: 2, permite_novos: true })
    await expect(rows(ID.donoB, "select * from get_plan_usage($1)", [loja])).rejects.toThrow(/forbidden/)
    await expect(rows(ID.cli, "select * from get_plan_usage($1)", [loja])).rejects.toThrow(/forbidden/)
  })

  it("o proprietário não cria barbearias sem limite", async () => {
    for (let i = 1; i <= 3; i++) await val(ID.multi, "select create_barbershop($1, $2)", [`Loja ${i}`, `loja-multi-${i}`])
    await expect(val(ID.multi, "select create_barbershop('Loja 4', 'loja-multi-4')")).rejects.toThrow(/shop_limit/)
  })
})

describe("F11-04: estados da assinatura (T13)", () => {
  it("teste vencido ou assinatura suspensa bloqueia novas reservas públicas; o histórico permanece", async () => {
    const semana = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))
    const [{ id: ana }] = await rows(ID.dono, "select id from professionals where nome = 'Ana'")
    await rows(ID.dono, "select save_working_hours($1, $2)", [ana, semana])
    const dia = await val(null, "select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text")
    const slots = await rows(null, "select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, ana, dia])
    const reservar = (i: number) => val(ID.cli, "select create_booking($1, $2, $3, $4, 'Cliente', '11912345678', false, false, null)", [loja, corte, ana, slots[i].slot_inicio])
    const primeira = await reservar(0) // em teste, dentro do prazo
    await sql("update subscriptions set trial_ate = now() - interval '1 day' where barbershop_id = $1", [loja])
    await expect(reservar(4)).rejects.toThrow(/subscription_inactive/)
    expect(await val(ID.cli, "select status from bookings where id = $1", [primeira])).toBe("confirmado")
    expect((await rows(ID.dono, "select permite_novos from get_plan_usage($1)", [loja]))[0].permite_novos).toBe(false)
    await sql("update subscriptions set trial_ate = now() + interval '5 days' where barbershop_id = $1", [loja])
    await reservar(4)
  })
})

describe("F11-03: eventos de cobrança idempotentes e fora de ordem (T14, T16)", () => {
  it("só o servidor aplica eventos de cobrança", async () => {
    for (const q of ["select apply_billing_event('p', 'e', gen_random_uuid(), 'ativada', null, null, now())", "select change_plan(gen_random_uuid(), 'rede')"]) {
      await expect(rows(ID.dono, q)).rejects.toThrow(/permission denied/)
      await expect(rows(null, q)).rejects.toThrow(/permission denied/)
    }
  })

  it("ativação aplica uma vez; o mesmo evento repetido é duplicado", async () => {
    const fim = new Date(Date.now() + 30 * 86400_000).toISOString()
    expect(await evento("ev-1", "ativada", { plano: "profissional", fim })).toBe("processado")
    expect(await evento("ev-1", "ativada", { plano: "profissional", fim })).toBe("duplicado")
    const [s] = await rows(ID.dono, "select plan_id, status from subscriptions where barbershop_id = $1", [loja])
    expect(s).toMatchObject({ plan_id: "profissional", status: "ativa" })
    await expect(rows(ID.dono, "select 1 from billing_events")).rejects.toThrow(/permission denied/) // log só para o servidor
  })

  it("evento antigo chegando depois de um mais novo é ignorado", async () => {
    const agora = Date.now()
    expect(await evento("ev-3", "suspensa", { ts: new Date(agora + 2000).toISOString() })).toBe("processado")
    expect(await evento("ev-2", "reativada", { ts: new Date(agora + 1000).toISOString(), fim: new Date(agora + 86400_000).toISOString() })).toBe("ignorado")
    expect((await rows(ID.dono, "select status from subscriptions where barbershop_id = $1", [loja]))[0].status).toBe("suspensa")
    expect((await rows(ID.dono, "select permite_novos from get_plan_usage($1)", [loja]))[0].permite_novos).toBe(false)
  })

  it("falha de pagamento entra em carência; reativação volta a ativa", async () => {
    const t = Date.now() + 10_000
    const fim = new Date(Date.now() + 30 * 86400_000).toISOString()
    expect(await evento("ev-4", "ativada", { fim, ts: new Date(t).toISOString() })).toBe("processado")
    expect(await evento("ev-5", "pagamento_falhou", { fim: new Date(Date.now() - 86400_000).toISOString(), ts: new Date(t + 1000).toISOString() })).toBe("processado")
    expect((await rows(ID.dono, "select status, permite_novos from get_plan_usage($1)", [loja]))[0]).toMatchObject({ status: "inadimplente", permite_novos: true }) // dentro da carência de 7 dias
    await sql("update subscriptions set periodo_fim = now() - interval '8 days' where barbershop_id = $1", [loja])
    expect((await rows(ID.dono, "select permite_novos from get_plan_usage($1)", [loja]))[0].permite_novos).toBe(false)
    expect(await evento("ev-6", "reativada", { fim, ts: new Date(t + 2000).toISOString() })).toBe("processado")
    expect((await rows(ID.dono, "select status from subscriptions where barbershop_id = $1", [loja]))[0].status).toBe("ativa")
  })

  it("downgrade para plano menor com profissionais demais é recusado e não altera a assinatura", async () => {
    await prof(ID.dono, "Davi") // plano profissional permite até 6
    expect(await svcVal("select change_plan($1, 'inicial')", [loja])).toBe("downgrade_blocked")
    expect((await rows(ID.dono, "select plan_id from subscriptions where barbershop_id = $1", [loja]))[0].plan_id).toBe("profissional")
    const [{ id }] = await rows(ID.dono, "select id from professionals where nome = 'Davi'")
    await val(ID.dono, "select save_professional($1, $2, 'Davi', false, $3)", [loja, id, [corte]])
    const [{ id: caio }] = await rows(ID.dono, "select id from professionals where nome = 'Caio'")
    await val(ID.dono, "select save_professional($1, $2, 'Caio', false, $3)", [loja, caio, [corte]])
    expect(await svcVal("select change_plan($1, 'inicial')", [loja])).toBe("ok")
    await expect(prof(ID.dono, "Eva")).resolves.toBeTruthy() // só Ana ativa
    await expect(prof(ID.dono, "Fábio")).rejects.toThrow(/plan_limit/)
  })

  it("plano inexistente e empresa inexistente são rejeitados", async () => {
    await expect(svc("select change_plan($1, 'ouro')", [loja])).rejects.toThrow(/invalid_plan/)
    await expect(evento("ev-7", "ativada", { shop: "00000000-0000-4000-8000-000000000999" })).rejects.toThrow(/not_found/)
    await expect(evento("ev-8", "inventado")).rejects.toThrow(/invalid_event/)
  })
})
