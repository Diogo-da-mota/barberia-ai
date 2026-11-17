/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Convite aceito → Equipe (0033) em PostgreSQL local (PGlite): barbeiro vira card de profissional vinculado à conta
// (liga o cadastro manual correspondente, sem duplicar); gerente entra só como membro; reservas e permissões preservadas.
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite({ extensions: { btree_gist } })
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), donoP: U("a2"), rafael: U("c1"), joao: U("c2"), ana: U("c3"), bruno: U("c4"), gerente: U("c5"), antigo: U("c6"), cheio: U("c7"), cheioAntigo: U("c8"), cliente: U("d1") }
const NOME: Record<string, string> = { dono: "Dono", donoP: "Dona P", rafael: "Rafael", joao: "João Silva", ana: "Ana", bruno: "Bruno", gerente: "Gina", antigo: "Otávio", cheio: "Caio", cheioAntigo: "Davi", cliente: "Cliente" }
const EMAIL = (n: keyof typeof ID) => `${n}@example.test`
const MIGRATION = readFileSync("supabase/migrations/0033_convite_equipe.sql", "utf8")
let loja = "", lojaP = "", corte = "", joaoManual = "", anaManual = "", brunoManual = "", reservaJoao = ""

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
const invite = (email: string, papel: "barbeiro" | "gerente", shop = () => loja, owner = ID.dono) => val(owner, "select create_invite($1, $2, $3)", [shop(), email, papel])
const accept = (user: string, token: string) => val(user, "select accept_invite($1)", [token])
const cards = async () => (await db.query<{ id: string; nome: string; profile_id: string | null; email: string | null }>("select id, nome, profile_id, email from professionals where barbershop_id = $1 order by nome", [loja])).rows
const allCards = async () => (await db.query("select id, nome, ativo, profile_id from professionals order by id")).rows

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `)
  for (const f of ["0001_identidade_inicial", "0002_catalogo", "0003_agenda", "0004_barbeiro", "0008_planos"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, EMAIL(n as keyof typeof ID), { full_name: NOME[n] }])

  loja = await val(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")
  await db.query("update subscriptions set plan_id = 'rede' where barbershop_id = $1", [loja]) // sem limite de profissionais
  corte = (await rows(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [loja]))[0].id
  // Cadastros manuais (sem conta): João com o e-mail do convite; Ana sem e-mail; outro Bruno com outro e-mail.
  joaoManual = await val(ID.dono, "select save_professional($1, null, 'João Silva', true, $2)", [loja, [corte]])
  anaManual = await val(ID.dono, "select save_professional($1, null, 'Ana', true, $2)", [loja, [corte]])
  brunoManual = await val(ID.dono, "select save_professional($1, null, 'Bruno', true, $2)", [loja, [corte]])
  await db.query("update professionals set email = $1 where id = $2", [EMAIL("joao"), joaoManual])
  await db.query("update professionals set email = 'outro.bruno@example.test' where id = $1", [brunoManual])
  // Reserva já existente do João (antes de ele ter conta).
  await rows(ID.dono, "select save_working_hours($1, $2)", [joaoManual, JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))])
  const dia = await val(null, "select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text")
  const slot = (await rows(null, "select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, joaoManual, dia]))[0].slot_inicio
  reservaJoao = await val(ID.cliente, "select create_booking($1, $2, $3, $4, 'Cliente', '11912345678', false, false, null)", [loja, corte, joaoManual, slot])
  // Barbeiro que aceitou o convite ANTES da correção: só tem o vínculo, sem card.
  await accept(ID.antigo, await invite(EMAIL("antigo"), "barbeiro"))
  // Barbearia P no plano Inicial (5 profissionais ativos) já no limite, com um convidado antigo sem card.
  lojaP = await val(ID.donoP, "select create_barbershop('Barbearia P', 'barbearia-p')")
  for (const nome of ["Primeiro", "Segundo", "Terceiro", "Quarto", "Quinto"]) await val(ID.donoP, "select save_professional($1, null, $2, true, $3)", [lojaP, nome, []])
  await accept(ID.cheioAntigo, await invite(EMAIL("cheioAntigo"), "barbeiro", () => lojaP, ID.donoP))

  await db.exec(MIGRATION)
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("convite aceito aparece na Equipe", () => {
  it("barbeiro sem cadastro: aceitar cria o card vinculado à conta, visível para a gestão", async () => {
    await accept(ID.rafael, await invite(EMAIL("rafael"), "barbeiro"))
    expect((await cards()).filter((c) => c.profile_id === ID.rafael)).toEqual([expect.objectContaining({ nome: "Rafael", email: EMAIL("rafael") })])
    expect((await rows(ID.dono, "select nome from professionals where barbershop_id = $1", [loja])).map((r) => r.nome)).toContain("Rafael")
    expect(await val(ID.rafael, "select papel from memberships where profile_id = $1", [ID.rafael])).toBe("barbeiro")
  })

  it("cadastro manual com o mesmo e-mail é vinculado, sem duplicar; a reserva continua e o barbeiro passa a vê-la", async () => {
    const antes = (await cards()).length
    await accept(ID.joao, await invite(EMAIL("joao"), "barbeiro"))
    expect((await cards()).length).toBe(antes)
    expect((await cards()).find((c) => c.id === joaoManual)!.profile_id).toBe(ID.joao)
    expect((await rows(ID.joao, "select id, professional_id from bookings")).map((b) => [b.id, b.professional_id])).toEqual([[reservaJoao, joaoManual]])
  })

  it("cadastro manual com o mesmo nome e sem e-mail é vinculado, sem duplicar", async () => {
    const antes = (await cards()).length
    await accept(ID.ana, await invite(EMAIL("ana"), "barbeiro"))
    expect((await cards()).length).toBe(antes)
    expect((await cards()).find((c) => c.id === anaManual)!.profile_id).toBe(ID.ana)
  })

  it("mesmo nome de outra pessoa (outro e-mail): card próprio; o cadastro manual fica intacto", async () => {
    await accept(ID.bruno, await invite(EMAIL("bruno"), "barbeiro"))
    const all = await cards()
    expect(all.find((c) => c.id === brunoManual)).toMatchObject({ nome: "Bruno", profile_id: null, email: "outro.bruno@example.test" })
    expect(all.filter((c) => c.profile_id === ID.bruno)).toEqual([expect.objectContaining({ nome: "Bruno · bruno" })])
  })

  it("gerente entra como membro com o papel gerente (sem card de profissional) e gerencia a equipe; barbeiro não", async () => {
    await accept(ID.gerente, await invite(EMAIL("gerente"), "gerente"))
    expect(await val(ID.gerente, "select papel from memberships where profile_id = $1", [ID.gerente])).toBe("gerente")
    expect((await cards()).some((c) => c.profile_id === ID.gerente)).toBe(false)
    expect(await val(ID.gerente, "select save_professional($1, null, 'Novo', true, $2)", [loja, [corte]])).toBeTruthy()
    await expect(val(ID.rafael, "select save_professional($1, null, 'Outro', true, $2)", [loja, [corte]])).rejects.toThrow(/forbidden/)
  })

  it("convite já aceito ou conta já membro: recusado e nada é duplicado", async () => {
    const antes = (await cards()).length
    await expect(accept(ID.rafael, await invite(EMAIL("rafael"), "barbeiro"))).rejects.toThrow(/already_member/)
    expect((await cards()).length).toBe(antes)
    expect(Number(await val(ID.dono, "select count(*) from memberships where barbershop_id = $1 and profile_id = $2", [loja, ID.rafael]))).toBe(1)
  })

  it("plano no limite: o convite é aceito e o card entra inativo (aparece na Equipe; a gestão ativa quando o plano permitir)", async () => {
    expect(await accept(ID.cheio, await invite(EMAIL("cheio"), "barbeiro", () => lojaP, ID.donoP))).toBe(lojaP)
    const daLoja = (await db.query<{ nome: string; ativo: boolean; profile_id: string | null }>("select nome, ativo, profile_id from professionals where barbershop_id = $1 order by nome", [lojaP])).rows
    expect(daLoja).toEqual([
      { nome: "Caio", ativo: false, profile_id: ID.cheio },
      { nome: "Davi", ativo: false, profile_id: ID.cheioAntigo }, // convidado antigo: card criado pelo SQL, inativo
      ...["Primeiro", "Quarto", "Quinto", "Segundo", "Terceiro"].map((nome) => ({ nome, ativo: true, profile_id: null })),
    ])
    // ativar acima do limite continua bloqueado pelo plano (regra preservada)
    const caio = (await db.query<{ id: string }>("select id from professionals where profile_id = $1", [ID.cheio])).rows[0].id
    await expect(val(ID.donoP, "select save_professional($1, $2, 'Caio', true, $3)", [lojaP, caio, []])).rejects.toThrow(/plan_limit/)
  })

  it("quem aceitou antes da correção ganha o card ao aplicar o SQL; reaplicar não duplica", async () => {
    expect((await cards()).filter((c) => c.profile_id === ID.antigo)).toEqual([expect.objectContaining({ nome: "Otávio" })])
    const antes = await allCards()
    await db.exec(MIGRATION)
    expect(await allCards()).toEqual(antes)
  })
})

describe("origem do cadastro na Equipe (0034)", () => {
  it("manual sem conta, conta Google ou por e-mail pelo Supabase Auth (método original); só a gestão consulta", async () => {
    // como no Supabase: identidades por provedor e o provedor de criação em app_metadata
    await db.exec(`
      create table if not exists auth.identities (user_id uuid, provider text, created_at timestamptz);
      alter table auth.users add column if not exists raw_app_meta_data jsonb not null default '{}';
    `)
    await db.exec(readFileSync("supabase/migrations/0034_origem_conta_equipe.sql", "utf8"))
    await db.query("insert into auth.identities values ($1, 'email', '2026-01-01'), ($2, 'google', '2026-01-01'), ($2, 'email', '2026-02-01')", [ID.joao, ID.ana])
    await db.query(`update auth.users set raw_app_meta_data = '{"provider":"google"}' where id = $1`, [ID.rafael]) // sem identidades: vale o provedor de criação
    await db.query(`update auth.users set raw_app_meta_data = '{"provider":"email"}' where id = $1`, [ID.bruno])
    const origem = Object.fromEntries((await rows(ID.dono, "select professional_id, origem from get_team_account_origins($1)", [loja])).map((r) => [r.professional_id, r.origem]))
    const card = async (user: string) => (await cards()).find((c) => c.profile_id === user)!.id
    expect(origem[joaoManual]).toBe("email") // era manual; aceitou o convite e passou a conta por e-mail
    expect(origem[anaManual]).toBe("google") // Google primeiro, e-mail depois: vale o original
    expect(origem[await card(ID.rafael)]).toBe("google")
    expect(origem[await card(ID.bruno)]).toBe("email")
    expect(origem[brunoManual]).toBe("manual") // sem conta vinculada
    expect(Object.values(origem).every((o) => ["manual", "google", "email"].includes(o))).toBe(true)
    await expect(rows(ID.joao, "select * from get_team_account_origins($1)", [loja])).rejects.toThrow(/forbidden/)
    await expect(rows(ID.cliente, "select * from get_team_account_origins($1)", [loja])).rejects.toThrow(/forbidden/)
    await expect(rows(null, "select * from get_team_account_origins($1)", [loja])).rejects.toThrow(/permission denied/)
  })
})

describe("segurança do aceite (0035): só a conta confirmada do e-mail do convite aceita", () => {
  const S = { certo: U("f1"), outro: U("f2"), pendente: U("f3"), maiusc: U("f4"), gerente2: U("f5") }
  const membros = async () => (await db.query("select profile_id, papel from memberships where barbershop_id = $1 order by profile_id", [loja])).rows
  const convite = async (email: string) => (await db.query("select aceito_em from invites where email = $1 order by criado_em desc limit 1", [email])).rows[0]

  beforeAll(async () => {
    await db.exec(readFileSync("supabase/migrations/0035_convite_email.sql", "utf8"))
    await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
      ($1, 'certo@example.test', now(), '{"full_name":"Certo"}'), ($2, 'outro@example.test', now(), '{"full_name":"Outro"}'),
      ($3, 'pendente2@example.test', null, '{"full_name":"Pendente"}'), ($4, 'Maiusc@Example.TEST', now(), '{"full_name":"Maiusc"}'),
      ($5, 'gina2@example.test', now(), '{"full_name":"Gina Dois"}')`, [S.certo, S.outro, S.pendente, S.maiusc, S.gerente2])
  })

  it("outro e-mail, mesmo confirmado: recusado no banco e nada é criado; depois o dono do e-mail aceita uma vez só", async () => {
    const token = await invite("certo@example.test", "barbeiro")
    const antes = { membros: await membros(), cards: await allCards() }
    await expect(accept(S.outro, token)).rejects.toThrow(/invite_wrong_email/)
    expect(await membros()).toEqual(antes.membros)
    expect(await allCards()).toEqual(antes.cards)
    expect((await convite("certo@example.test")).aceito_em).toBeNull()

    expect(await accept(S.certo, token)).toBe(loja)
    expect((await membros()).filter((m) => m.profile_id === S.certo)).toEqual([{ profile_id: S.certo, papel: "barbeiro" }])
    expect((await cards()).filter((c) => c.profile_id === S.certo)).toHaveLength(1)
    // reutilizar: nem o próprio, nem outra conta; nada duplica
    await expect(accept(S.certo, token)).rejects.toThrow(/invalid_invite/)
    await expect(accept(S.outro, token)).rejects.toThrow(/invalid_invite/)
    expect((await cards()).filter((c) => c.profile_id === S.certo)).toHaveLength(1)
  })

  it("e-mail não confirmado: recusado e nada é criado", async () => {
    const token = await invite("pendente2@example.test", "barbeiro")
    await expect(accept(S.pendente, token)).rejects.toThrow(/email_not_confirmed/)
    expect((await membros()).some((m) => m.profile_id === S.pendente)).toBe(false)
    expect((await convite("pendente2@example.test")).aceito_em).toBeNull()
  })

  it("convite expirado e token inexistente: recusados sem revelar nada", async () => {
    const token = await invite("outro@example.test", "barbeiro")
    await db.query("update invites set expires_at = now() - interval '1 second' where email = 'outro@example.test'")
    await expect(accept(S.outro, token)).rejects.toThrow(/invalid_invite/)
    await expect(accept(S.outro, "nao-existe")).rejects.toThrow(/invalid_invite/)
    await expect(accept(S.outro, await invite("certo@example.test", "barbeiro"))).rejects.toThrow(/invite_wrong_email/) // outro token, outro e-mail
    expect((await membros()).some((m) => m.profile_id === S.outro)).toBe(false)
  })

  it("maiúsculas e espaços não importam; barbearia e papel vêm só do convite; o token não aparece em registro nenhum", async () => {
    const token = await invite("  MAIUSC@example.test ", "barbeiro") // espaços e maiúsculas no convite e na conta
    expect(await accept(S.maiusc, token)).toBe(loja)
    const tokenG = await invite("gina2@example.test", "gerente")
    expect(await accept(S.gerente2, tokenG)).toBe(loja)
    expect((await membros()).find((m) => m.profile_id === S.gerente2)).toEqual({ profile_id: S.gerente2, papel: "gerente" })
    expect((await cards()).some((c) => c.profile_id === S.gerente2)).toBe(false) // gerente não vira card
    expect((await db.query("select count(*)::int n from memberships where profile_id = $1", [S.gerente2])).rows).toEqual([{ n: 1 }]) // só nesta barbearia
    for (const t of [token, tokenG]) expect((await db.query("select count(*)::int n from audit_logs where detalhes::text like '%' || $1 || '%'", [t])).rows).toEqual([{ n: 0 }])
  })
})

describe("renovar link e não duplicar convites (0036)", () => {
  const R = { novo: U("e1"), outroR: U("e2") }
  const hashes = async (email: string) => (await db.query("select id, token_hash, aceito_em from invites where email = $1 order by criado_em", [email])).rows
  const renew = (user: string, id: string) => val(user, "select renew_invite($1)", [id])

  beforeAll(async () => {
    await db.exec(readFileSync("supabase/migrations/0036_convite_renovar.sql", "utf8"))
    await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
      ($1, 'renova@example.test', now(), '{"full_name":"Renova"}'), ($2, 'intruso@example.test', now(), '{"full_name":"Intruso"}')`, [R.novo, R.outroR])
  })

  it("renovar: novo link no MESMO convite, o anterior deixa de valer, prazo de 7 dias, e o e-mail certo continua obrigatório", async () => {
    const antigo = await invite("renova@example.test", "barbeiro")
    const [{ id }] = await hashes("renova@example.test")
    const novo = await renew(ID.dono, id)
    expect(novo).not.toBe(antigo)
    expect(await hashes("renova@example.test")).toHaveLength(1) // nada duplicado
    const [{ dias }] = (await db.query("select round(extract(epoch from expires_at - now()) / 86400) dias from invites where id = $1", [id])).rows
    expect(Number(dias)).toBe(7)
    await expect(accept(R.novo, antigo)).rejects.toThrow(/invalid_invite/) // link antigo morreu
    await expect(accept(R.outroR, novo)).rejects.toThrow(/invite_wrong_email/)
    expect(await accept(R.novo, novo)).toBe(loja)
    await expect(renew(ID.dono, id)).rejects.toThrow(/invite_closed/) // aceito: não renova
  })

  it("convite expirado não renova; gerar de novo cria um convite novo", async () => {
    await invite("expira@example.test", "barbeiro")
    await db.query("update invites set expires_at = now() - interval '1 minute' where email = 'expira@example.test'")
    const [{ id }] = await hashes("expira@example.test")
    await expect(renew(ID.dono, id)).rejects.toThrow(/invite_closed/)
    await invite("expira@example.test", "barbeiro")
    expect(await hashes("expira@example.test")).toHaveLength(2)
  })

  it("gerar de novo para o mesmo e-mail e papel renova o pendente (sem duplicar); outro papel é outro convite", async () => {
    const t1 = await invite("dup@example.test", "barbeiro")
    const t2 = await invite("  DUP@example.test ", "barbeiro")
    expect(await hashes("dup@example.test")).toHaveLength(1)
    expect(t2).not.toBe(t1)
    await invite("dup@example.test", "gerente")
    expect(await hashes("dup@example.test")).toHaveLength(2)
  })

  it("só a gestão renova: gerente só convite de barbeiro; barbeiro, cliente e outra barbearia não; o token não vai para registro nenhum", async () => {
    await invite("perm@example.test", "barbeiro")
    await invite("permg@example.test", "gerente")
    const [{ id: barb }] = await hashes("perm@example.test")
    const [{ id: ger }] = await hashes("permg@example.test")
    const t = await renew(ID.gerente, barb)
    expect(typeof t).toBe("string")
    await expect(renew(ID.gerente, ger)).rejects.toThrow(/forbidden/)
    for (const u of [ID.joao, ID.cliente, ID.donoP]) await expect(renew(u, barb)).rejects.toThrow(/forbidden/)
    await expect(rows(null, "select renew_invite($1)", [barb])).rejects.toThrow(/permission denied/)
    await expect(rows(ID.dono, "select private.rotate_invite_token($1)", [barb])).rejects.toThrow(/permission denied/)
    expect((await db.query("select count(*)::int n from audit_logs where detalhes::text like '%' || $1 || '%'", [t])).rows).toEqual([{ n: 0 }])
  })
})
