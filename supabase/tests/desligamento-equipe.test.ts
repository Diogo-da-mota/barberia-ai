/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Desligamento da equipe (0038) em PostgreSQL local (PGlite): card desativado ou excluído corta o acesso do barbeiro às
// reservas, comissões, presença e Google Agenda do card; proprietário e gerente não são afetados; reativar devolve o acesso.
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite({ extensions: { btree_gist } })
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), gerente: U("a2"), joao: U("b1"), rafael: U("b2"), pedro: U("b3"), cliente: U("c1") }
const NOME: Record<string, string> = { dono: "Dono", gerente: "Gina", joao: "João Silva", rafael: "Rafael", pedro: "Pedro", cliente: "Maria" }
const EMAIL = (n: keyof typeof ID) => `${n}@example.test`
let loja = "", corte = "", cardJoao = "", cardRafael = "", cardPedro = "", reservaPassada = ""
let antesDaCorrecao: { reservas: number; meu: string | null } = { reservas: 0, meu: null }

async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""])
  await db.exec(`set role ${user ? "authenticated" : "anon"}`)
  try {
    return await fn()
  } finally {
    await db.exec("reset role")
  }
}
const rows = (user: string | null, sql: string, params: unknown[] = []) => as(user, async () => (await db.query<Record<string, any>>(sql, params)).rows)
const val = async (user: string | null, sql: string, params: unknown[] = []) => Object.values((await rows(user, sql, params))[0])[0] as any
const invite = (email: string, papel: "barbeiro" | "gerente") => val(ID.dono, "select create_invite($1, $2, $3)", [loja, email, papel])
const accept = (user: string, token: string) => val(user, "select accept_invite($1)", [token])
const cardDe = async (user: string) => (await db.query<{ id: string }>("select id from professionals where profile_id = $1", [user])).rows[0]?.id ?? null
const ativo = (card: string, nome: string, valor: boolean) => rows(ID.dono, "select save_professional($1, $2, $3, $4, $5)", [loja, card, nome, valor, [corte]])
const papel = async (user: string) => (await db.query<{ papel: string }>("select papel from memberships where barbershop_id = $1 and profile_id = $2", [loja, user])).rows[0]?.papel ?? null
const acesso = async (user: string) => ({
  reservas: (await rows(user, "select id from bookings where barbershop_id = $1", [loja])).length,
  comissoes: (await rows(user, "select id from commissions")).length,
  meu: (await val(user, "select my_professional($1)", [loja])) as string | null,
})
const conexao = async (card: string) => ({
  status: (await db.query<{ status: string }>("select status from calendar_connections where professional_id = $1", [card])).rows[0]?.status ?? null,
  credenciais: Number((await db.query<{ n: number }>("select count(*)::int n from calendar_credentials where professional_id = $1", [card])).rows[0].n),
})

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `)
  for (const f of ["0001_identidade_inicial", "0002_catalogo", "0003_agenda", "0004_barbeiro", "0005_financeiro", "0006_eventos", "0008_planos", "0009_calendario", "0033_convite_equipe", "0035_convite_email", "0036_convite_renovar", "0037_convite_vinculo_email"]) {
    await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  }
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, EMAIL(n as keyof typeof ID), { full_name: NOME[n] }])

  loja = await val(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")
  await db.query("update subscriptions set plan_id = 'rede' where barbershop_id = $1", [loja])
  corte = (await rows(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [loja]))[0].id
  for (const n of ["joao", "rafael", "pedro"] as const) await accept(ID[n], await invite(EMAIL(n), "barbeiro"))
  await accept(ID.gerente, await invite(EMAIL("gerente"), "gerente"))
  cardJoao = (await cardDe(ID.joao))!
  cardRafael = (await cardDe(ID.rafael))!
  cardPedro = (await cardDe(ID.pedro))!
  await rows(ID.dono, "select save_professional($1, $2, 'João Silva', true, $3)", [loja, cardJoao, [corte]])

  // Duas reservas da Maria com o João; uma vai para o passado (pode ser marcada) e recebe comissão.
  await rows(ID.dono, "select save_working_hours($1, $2)", [cardJoao, JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))])
  const dia = await val(null, "select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text")
  const slots = (await rows(null, "select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, cardJoao, dia])).map((s) => s.slot_inicio)
  await val(ID.cliente, "select create_booking($1, $2, $3, $4, 'Maria', '64992750733', false, false, null)", [loja, corte, cardJoao, slots[0]])
  reservaPassada = await val(ID.cliente, "select create_booking($1, $2, $3, $4, 'Maria', '64992750733', false, false, null)", [loja, corte, cardJoao, slots[4]])
  await db.query("update bookings set inicio = now() - interval '2 hours', fim = now() - interval '80 minutes' where id = $1", [reservaPassada])
  await db.query("insert into commissions (barbershop_id, booking_id, professional_id, base_centavos, regra_tipo, regra_valor, valor_centavos) values ($1, $2, $3, 6000, 'percentual', 40, 2400)", [loja, reservaPassada, cardJoao])

  // Google Agenda do João ligado (estado que o retorno do Google deixaria).
  await val(ID.joao, "select start_calendar_link($1)", [cardJoao])
  await db.query("update calendar_connections set status = 'ativo', calendar_id = 'primary', escopos = '{https://www.googleapis.com/auth/calendar.events}' where professional_id = $1", [cardJoao])
  await db.query("insert into calendar_credentials (professional_id, refresh_token) values ($1, 'rt-ficticio-joao')", [cardJoao])

  // Antes da correção: o card desativado continuava dando acesso (o defeito que a 0038 corrige).
  await ativo(cardJoao, "João Silva", false)
  const a = await acesso(ID.joao)
  antesDaCorrecao = { reservas: a.reservas, meu: a.meu }
  await ativo(cardJoao, "João Silva", true)

  await db.exec(readFileSync("supabase/migrations/0038_desligamento_equipe.sql", "utf8"))
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("desligamento da equipe (0038)", () => {
  it("antes da 0038 o card desativado ainda dava acesso; barbeiro ativo continua com a agenda, comissões e Google Agenda do próprio card", async () => {
    expect(antesDaCorrecao).toEqual({ reservas: 2, meu: cardJoao })
    expect(await acesso(ID.joao)).toEqual({ reservas: 2, comissoes: 1, meu: cardJoao })
    expect(typeof (await val(ID.joao, "select start_calendar_link($1)", [cardJoao]))).toBe("string")
    expect(await conexao(cardJoao)).toEqual({ status: "ativo", credenciais: 1 })
  })

  it("desativar o card corta reservas, comissões, presença, Google Agenda e my_professional; a gestão segue vendo tudo", async () => {
    await ativo(cardJoao, "João Silva", false)
    expect(await acesso(ID.joao)).toEqual({ reservas: 0, comissoes: 0, meu: null })
    await expect(rows(ID.joao, "select set_booking_status($1, 'nao_compareceu')", [reservaPassada])).rejects.toThrow(/forbidden/)
    await expect(rows(ID.joao, "select start_calendar_link($1)", [cardJoao])).rejects.toThrow(/forbidden/)
    expect(await conexao(cardJoao)).toEqual({ status: "desvinculado", credenciais: 0 })
    for (const gestor of [ID.dono, ID.gerente]) {
      expect((await rows(gestor, "select id from bookings where barbershop_id = $1", [loja])).length).toBe(2)
      expect((await rows(gestor, "select id from commissions")).length).toBe(1)
    }
    expect([await papel(ID.dono), await papel(ID.gerente), await papel(ID.joao)]).toEqual(["proprietario", "gerente", "barbeiro"])
  })

  it("reativar devolve agenda e financeiro do card; o Google Agenda fica desvinculado até o barbeiro ligar de novo", async () => {
    await ativo(cardJoao, "João Silva", true)
    expect(await acesso(ID.joao)).toEqual({ reservas: 2, comissoes: 1, meu: cardJoao })
    await rows(ID.joao, "select set_booking_status($1, 'nao_compareceu')", [reservaPassada])
    expect(await conexao(cardJoao)).toEqual({ status: "desvinculado", credenciais: 0 })
  })

  it("card com histórico não pode ser excluído (o vínculo fica e a gestão desativa); card sem histórico excluído remove o papel barbeiro", async () => {
    await expect(rows(ID.dono, "delete from professionals where id = $1", [cardJoao])).rejects.toThrow(/violates RESTRICT setting of foreign key/)
    expect(await papel(ID.joao)).toBe("barbeiro")

    expect((await rows(ID.dono, "delete from professionals where id = $1 returning id", [cardRafael])).length).toBe(1)
    expect(await papel(ID.rafael)).toBeNull()
    expect(await val(ID.rafael, "select private.has_role($1, array['barbeiro'])", [loja])).toBe(false)
    expect(await val(ID.rafael, "select my_professional($1)", [loja])).toBeNull()
    expect(Number(await val(ID.dono, "select count(*) from audit_logs where acao = 'member.removed' and profile_id = $1", [ID.dono]))).toBe(1)
    // Readmissão por convite volta a funcionar (antes dava already_member).
    expect(await accept(ID.rafael, await invite(EMAIL("rafael"), "barbeiro"))).toBe(loja)
    expect(await papel(ID.rafael)).toBe("barbeiro")
  })

  it("sem vínculo atual de equipe (removido à parte), o card não autoriza mais nada", async () => {
    expect(await val(ID.pedro, "select my_professional($1)", [loja])).toBe(cardPedro)
    await db.query("delete from memberships where barbershop_id = $1 and profile_id = $2", [loja, ID.pedro])
    expect(await val(ID.pedro, "select my_professional($1)", [loja])).toBeNull()
    await expect(rows(ID.pedro, "select start_calendar_link($1)", [cardPedro])).rejects.toThrow(/forbidden/)
  })

  it("proprietário e gerente nunca perdem o papel ao excluir um card ligado à conta deles", async () => {
    const card = await val(ID.dono, "select save_professional($1, null, 'Card da Gina', true, $2)", [loja, [corte]])
    await db.query("update professionals set profile_id = $1 where id = $2", [ID.gerente, card])
    await rows(ID.dono, "delete from professionals where id = $1", [card])
    expect(await papel(ID.gerente)).toBe("gerente")
    expect(await papel(ID.dono)).toBe("proprietario")
  })
})

describe("tirar ou trocar a conta do card encerra o Google Agenda (0043)", () => {
  /** Estado que o retorno do Google deixaria: conexão ativa, token guardado e um evento na fila do calendário. */
  const ligarAgenda = async (card: string, user: string) => {
    await val(user, "select start_calendar_link($1)", [card])
    await db.query("update calendar_connections set status = 'ativo', calendar_id = 'primary' where professional_id = $1", [card])
    await db.query("insert into calendar_credentials (professional_id, refresh_token) values ($1, 'rt-ficticio') on conflict (professional_id) do update set refresh_token = excluded.refresh_token", [card])
    await db.query("insert into outbox_events (barbershop_id, tipo, canal, destino, dedup_key) values ($1, 'calendar_upsert', 'google_calendar', $2, $3)", [loja, card, `teste-${card}-${Date.now()}`])
  }
  const filaPendente = async (card: string) =>
    Number((await db.query<{ n: number }>("select count(*)::int n from outbox_events where canal = 'google_calendar' and destino = $1 and status = 'pendente'", [card])).rows[0].n)

  it("antes da 0043, link_professional(card, null) deixava a conexão ativa e o token da conta anterior; depois, encerra tudo", async () => {
    const card = (await cardDe(ID.rafael))!
    await ligarAgenda(card, ID.rafael)
    await rows(ID.dono, "select link_professional($1, null)", [card])
    expect(await conexao(card)).toEqual({ status: "ativo", credenciais: 1 }) // o defeito, só com a 0038

    await db.query("update professionals set profile_id = $1 where id = $2", [ID.rafael, card])
    await db.exec(readFileSync("supabase/migrations/0043_agenda_desvincular_conta.sql", "utf8"))
    expect(await conexao(card)).toEqual({ status: "ativo", credenciais: 1 })
    await rows(ID.dono, "select link_professional($1, null)", [card])
    expect(await conexao(card)).toEqual({ status: "desvinculado", credenciais: 0 })
    expect(await filaPendente(card)).toBe(0)
  })

  it("trocar a conta ligada ao card encerra a conexão da conta anterior; a nova conta liga a própria agenda", async () => {
    const card = (await cardDe(ID.joao))!
    await ligarAgenda(card, ID.joao)
    await rows(ID.dono, "select link_professional($1, null)", [card])
    await rows(ID.dono, "select link_professional($1, $2)", [card, ID.rafael])
    expect(await conexao(card)).toEqual({ status: "desvinculado", credenciais: 0 })
    expect(await val(ID.rafael, "select my_professional($1)", [loja])).toBe(card)
    expect(typeof (await val(ID.rafael, "select start_calendar_link($1)", [card]))).toBe("string")
  })

  it("excluir a conta (perfil) solta o card e encerra a conexão; editar nome e serviços do card não mexe na conexão", async () => {
    const tiago = U("b9")
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'tiago@example.test', '{\"full_name\":\"Tiago\"}')", [tiago])
    await accept(tiago, await invite("tiago@example.test", "barbeiro"))
    const card = (await cardDe(tiago))!
    await ligarAgenda(card, tiago)
    await rows(ID.dono, "select save_professional($1, $2, 'Tiago Souza', true, $3)", [loja, card, [corte]])
    expect(await conexao(card)).toEqual({ status: "ativo", credenciais: 1 })
    await db.query("delete from profiles where id = $1", [tiago])
    expect((await db.query<{ profile_id: string | null }>("select profile_id from professionals where id = $1", [card])).rows[0].profile_id).toBeNull()
    expect(await conexao(card)).toEqual({ status: "desvinculado", credenciais: 0 })
  })

  it("card já sem conta com conexão antiga (deixada pelo defeito antes da 0043) é limpo ao ser ligado a outra conta", async () => {
    const lucas = U("ba")
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'lucas@example.test', '{\"full_name\":\"Lucas\"}')", [lucas])
    await accept(lucas, await invite("lucas@example.test", "barbeiro"))
    const card = (await cardDe(lucas))!
    await ligarAgenda(card, lucas)
    await db.exec("alter table professionals disable trigger professionals_revoke_access") // a conta saiu quando o gatilho não existia
    await db.query("update professionals set profile_id = null where id = $1", [card])
    await db.exec("alter table professionals enable trigger professionals_revoke_access")
    expect(await conexao(card)).toEqual({ status: "ativo", credenciais: 1 })
    await rows(ID.dono, "select link_professional($1, $2)", [card, ID.joao])
    expect(await conexao(card)).toEqual({ status: "desvinculado", credenciais: 0 })
    expect(await filaPendente(card)).toBe(0)
  })
})
