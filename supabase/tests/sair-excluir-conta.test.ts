/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Saída da barbearia e exclusão da conta da equipe (migration 0057) em PostgreSQL local (PGlite), só com dados fictícios.
// Duas barbearias: Central (dono) e Norte (dono2). Carlos é barbeiro nas duas; Duda é barbeira na Central e cliente na Norte.
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), dono2: U("a2"), gerente: U("a3"), carlos: U("b1"), bia: U("b2"), rafa: U("b3"), duda: U("b4"), maria: U("c1"), joao: U("c2") }
type Pessoa = keyof typeof ID
const NOME: Record<Pessoa, string> = { dono: "Dono", dono2: "Dona Norte", gerente: "Gina", carlos: "Carlos", bia: "Bia", rafa: "Rafa", duda: "Duda", maria: "Maria", joao: "João Silva" }
const EMAIL = (n: Pessoa) => `${n}@example.test`

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

type Amr = { method: string; timestamp: number }[]
const agora = () => Math.floor(Date.now() / 1000)
const db = new PGlite({ extensions: { btree_gist } })
let lojaA = "", lojaB = "", corteA = "", corteB = "", dia = ""
const card: Record<string, string> = {}
const reserva: Record<string, string> = {}
let financeiroAntes = ""

/** Chamada com o token da pessoa; `amr` = como ela entrou (padrão: login com senha agora). */
async function as<T>(user: string | null, fn: () => Promise<T>, amr: Amr = [{ method: "password", timestamp: agora() }]): Promise<T> {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""])
  await db.query("select set_config('request.jwt.claims', $1, false)", [user ? JSON.stringify({ sub: user, amr }) : ""])
  await db.exec(`set role ${user ? "authenticated" : "anon"}`)
  try {
    return await fn()
  } finally {
    await db.exec("reset role")
  }
}
const sql = async (q: string, p: unknown[] = []) => (await db.query<Record<string, any>>(q, p)).rows
const de = (user: string | null, q: string, p: unknown[] = [], amr?: Amr) => as(user, () => sql(q, p), amr)
const um = async (user: string | null, q: string, p: unknown[] = [], amr?: Amr) => Object.values((await de(user, q, p, amr))[0])[0] as any
const falha = async (user: string | null, q: string, p: unknown[] = [], amr?: Amr) => {
  try { await de(user, q, p, amr); return null } catch (e) { return String((e as Error).message) }
}
const papel = async (user: string, loja: string) => (await sql("select papel from memberships where barbershop_id = $1 and profile_id = $2", [loja, user]))[0]?.papel ?? null
const cardDe = async (user: string, loja: string) => (await sql("select id from professionals where barbershop_id = $1 and profile_id = $2", [loja, user]))[0].id as string
const horario = (c: string, dono: string) => de(dono, "select save_working_hours($1, $2)", [c, JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))])
const livres = async (loja: string, corte: string, c: string) => (await sql("select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, c, dia])).map((r) => r.slot_inicio)
const reservar = async (user: Pessoa, loja: string, corte: string, c: string, inicio: string) =>
  um(ID[user], "select create_booking($1, $2, $3, $4, $5, '64992750733', true, false, null)", [loja, corte, c, inicio, NOME[user]])
const atendida = (id: string) => sql("update bookings set inicio = now() - interval '3 days', fim = now() - interval '3 days' + interval '40 minutes', status = 'concluido' where id = $1", [id])
const hash = (token: string) => sql("select encode(sha256(convert_to($1, 'utf8')), 'hex') h", [token]).then((r) => r[0].h as string)
/** Tudo o que é financeiro, linha a linha: precisa sair igual de qualquer saída ou exclusão. */
const financeiro = async () => JSON.stringify(await sql(`select
  (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]') from payments x) pagamentos,
  (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]') from refunds x) estornos,
  (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]') from commissions x) comissoes,
  (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]') from payouts x) repasses,
  (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]') from financial_ledger x) razao`))

beforeAll(async () => {
  await db.exec(AMBIENTE)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  for (const n of Object.keys(ID) as Pessoa[]) await sql("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [ID[n], EMAIL(n), { full_name: NOME[n] }])

  lojaA = await um(ID.dono, "select create_barbershop('Barbearia Central', 'barbearia-central')")
  lojaB = await um(ID.dono2, "select create_barbershop('Barbearia Norte', 'barbearia-norte')")
  await sql("update subscriptions set plan_id = 'rede'")
  corteA = (await de(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [lojaA]))[0].id
  corteB = (await de(ID.dono2, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 5000, 40) returning id", [lojaB]))[0].id

  const convidar = async (dono: string, loja: string, n: Pessoa, p: "barbeiro" | "gerente") =>
    um(ID[n], "select accept_invite($1)", [await um(dono, "select create_invite($1, $2, $3)", [loja, EMAIL(n), p])])
  for (const n of ["carlos", "bia", "rafa", "duda"] as const) await convidar(ID.dono, lojaA, n, "barbeiro")
  await convidar(ID.dono, lojaA, "gerente", "gerente")
  await convidar(ID.dono2, lojaB, "carlos", "barbeiro")
  for (const n of ["carlos", "bia", "rafa", "duda"] as const) {
    card[`${n}A`] = await cardDe(ID[n], lojaA)
    await de(ID.dono, "select save_professional($1, $2, $3, true, $4)", [lojaA, card[`${n}A`], NOME[n], [corteA]])
    await horario(card[`${n}A`], ID.dono)
  }
  card.carlosB = await cardDe(ID.carlos, lojaB)
  await de(ID.dono2, "select save_professional($1, $2, 'Carlos', true, $3)", [lojaB, card.carlosB, [corteB]])
  await horario(card.carlosB, ID.dono2)

  dia = (await sql("select ((now() at time zone 'America/Sao_Paulo')::date + 2)::text d"))[0].d
  const a = await livres(lojaA, corteA, card.carlosA)
  const b = await livres(lojaB, corteB, card.carlosB)
  reserva.futuraCarlos = await reservar("maria", lojaA, corteA, card.carlosA, a[0])
  reserva.passadaCarlos = await reservar("maria", lojaA, corteA, card.carlosA, a[4])
  reserva.passadaDuda = await reservar("joao", lojaA, corteA, card.dudaA, a[8])
  reserva.futuraJoaoB = await reservar("joao", lojaB, corteB, card.carlosB, b[0])
  reserva.dudaCliente = await reservar("duda", lojaB, corteB, card.carlosB, b[4])
  await atendida(reserva.passadaCarlos)
  await atendida(reserva.passadaDuda)

  // Financeiro: pagamento confirmado, comissões e um repasse.
  const pag = await um(ID.dono, "select register_payment($1, 6000, 'pix', 1, 'k-pag-carlos')", [reserva.passadaCarlos])
  await de(ID.dono, "select confirm_payment($1)", [pag])
  await sql("insert into commissions (barbershop_id, booking_id, professional_id, base_centavos, regra_tipo, regra_valor, valor_centavos) values ($1, $2, $3, 6000, 'percentual', 40, 2400) on conflict (booking_id) do nothing", [lojaA, reserva.passadaCarlos, card.carlosA])
  await sql("insert into commissions (barbershop_id, booking_id, professional_id, base_centavos, regra_tipo, regra_valor, valor_centavos) values ($1, $2, $3, 6000, 'percentual', 50, 3000) on conflict (booking_id) do nothing", [lojaA, reserva.passadaDuda, card.dudaA])
  await sql("insert into payouts (barbershop_id, professional_id, valor_centavos, idempotency_key) values ($1, $2, 1000, 'rep-carlos-1')", [lojaA, card.carlosA])

  // Google Agenda do Carlos na Central (estado que o retorno do Google deixaria).
  await de(ID.carlos, "select start_calendar_link($1)", [card.carlosA])
  await sql("update calendar_connections set status = 'ativo', calendar_id = 'primary', escopos = '{https://www.googleapis.com/auth/calendar.events}' where professional_id = $1", [card.carlosA])
  await sql("insert into calendar_credentials (professional_id, refresh_token) values ($1, 'rt-ficticio-carlos')", [card.carlosA])

  // Foto e contato no card da Duda e da Bia (gravados pela gestão).
  await sql("update professionals set avatar_path = $2, telefone = '64992750733', documento = '52998224725' where id = $1", [card.dudaA, `BARBEARIA/${lojaA}/profissionais/${card.dudaA}/foto.jpg`])
  await sql("update professionals set telefone = '64988887777' where id = $1", [card.biaA])
  await sql("update professionals set avatar_path = $2, telefone = '64977776666' where id = $1", [card.rafaA, `BARBEARIA/${lojaA}/profissionais/${card.rafaA}/foto.jpg`])

  // Convites ainda válidos, deixados para trás: Carlos na Central e Duda na Norte.
  await sql("insert into invites (barbershop_id, email, papel, token_hash, expires_at) values ($1, $2, 'barbeiro', $3, now() + interval '3 days')", [lojaA, EMAIL("carlos"), await hash("convite-antigo-carlos")])
  await sql("insert into invites (barbershop_id, email, papel, token_hash, expires_at) values ($1, $2, 'barbeiro', $3, now() + interval '3 days')", [lojaB, EMAIL("duda"), await hash("convite-duda-norte")])

  financeiroAntes = await financeiro()
}, 90_000)

afterAll(async () => { await db.close() })

describe("sair da barbearia (0057)", () => {
  it("o resumo mostra só o que é do próprio card; cliente e proprietário não têm o que sair", async () => {
    const pendente = Number((await sql("select coalesce(sum(valor_centavos), 0) v from commissions where professional_id = $1 and status = 'provisionada' and payout_id is null", [card.carlosA]))[0].v)
    expect(pendente).toBeGreaterThan(0)
    expect(await um(ID.carlos, "select get_leave_summary($1)", [lojaA])).toEqual({ papel: "barbeiro", pode_sair: true, reservas_futuras: 1, comissoes_a_receber_centavos: pendente, google_agenda: true })
    expect(await um(ID.carlos, "select get_leave_summary($1)", [lojaB])).toMatchObject({ papel: "barbeiro", reservas_futuras: 2, google_agenda: false })
    expect(await um(ID.bia, "select get_leave_summary($1)", [lojaA])).toEqual({ papel: "barbeiro", pode_sair: true, reservas_futuras: 0, comissoes_a_receber_centavos: 0, google_agenda: false })
    expect(await um(ID.maria, "select get_leave_summary($1)", [lojaA])).toEqual({ papel: null, pode_sair: false })
    expect(await um(ID.dono, "select get_leave_summary($1)", [lojaA])).toMatchObject({ papel: "proprietario", pode_sair: false })
  })

  it("1. o barbeiro sai da própria barbearia: perde o vínculo; o card fica inativo, sem conta e sem Google Agenda", async () => {
    expect(await um(ID.carlos, "select leave_barbershop($1)", [lojaA])).toEqual({ status: "saiu", reservas_futuras: 1 })
    expect(await papel(ID.carlos, lojaA)).toBeNull()
    expect((await sql("select ativo, profile_id, nome, desligado_em is not null desligado from professionals where id = $1", [card.carlosA]))[0])
      .toEqual({ ativo: false, profile_id: null, nome: "Carlos", desligado: true })
    expect((await sql("select status from calendar_connections where professional_id = $1", [card.carlosA]))[0].status).toBe("desvinculado")
    expect(await sql("select 1 from calendar_credentials where professional_id = $1", [card.carlosA])).toHaveLength(0)
    expect(await sql("select detalhes->>'origem' o from audit_logs where barbershop_id = $1 and acao = 'member.left' and profile_id = $2", [lojaA, ID.carlos])).toEqual([{ o: "saida" }])
    expect((await sql("select expires_at <= now() expirado from invites where token_hash = $1", [await hash("convite-antigo-carlos")]))[0].expirado).toBe(true)
  })

  it("2. não remove outro profissional: a função não recebe pessoa nem card, e as escritas diretas são recusadas", async () => {
    const biaAntes = await sql("select m.papel, p.ativo, p.profile_id from memberships m join professionals p on p.profile_id = m.profile_id and p.barbershop_id = m.barbershop_id where m.profile_id = $1", [ID.bia])
    expect(await um(ID.carlos, "select leave_barbershop($1)", [lojaA])).toEqual({ status: "ja_saiu", reservas_futuras: 0 })
    expect(await um(ID.bia, "select leave_barbershop($1)", [lojaB])).toEqual({ status: "ja_saiu", reservas_futuras: 0 })
    expect(await papel(ID.carlos, lojaB)).toBe("barbeiro")
    expect(await falha(ID.carlos, "delete from memberships where profile_id = $1", [ID.bia])).toMatch(/permission denied/)
    expect(await falha(ID.bia, "update professionals set ativo = false where id = $1", [card.rafaA])).toMatch(/permission denied/)
    expect(await falha(ID.bia, "update professionals set desligado_em = null where id = $1", [card.carlosA])).toMatch(/permission denied/)
    expect(await falha(ID.bia, "select private.recent_auth()")).toMatch(/permission denied/)
    expect(await sql("select m.papel, p.ativo, p.profile_id from memberships m join professionals p on p.profile_id = m.profile_id and p.barbershop_id = m.barbershop_id where m.profile_id = $1", [ID.bia])).toEqual(biaAntes)
  })

  it("3. a mesma sessão, depois de sair, não lê clientes, reservas, comissões, repasses nem pagamentos da barbearia", async () => {
    for (const tabela of ["bookings", "occupancies", "commissions", "payouts", "payments", "audit_logs"]) {
      expect(await de(ID.carlos, `select 1 from ${tabela} where barbershop_id = $1`, [lojaA]), tabela).toHaveLength(0)
    }
    expect(await um(ID.carlos, "select my_professional($1)", [lojaA])).toBeNull()
    expect(await falha(ID.carlos, "select set_booking_status($1, 'nao_compareceu')", [reserva.futuraCarlos])).toMatch(/forbidden/)
    expect(await um(ID.carlos, "select get_leave_summary($1)", [lojaA])).toEqual({ papel: null, pode_sair: false })
  })

  it("4. continua com o acesso legítimo à outra barbearia", async () => {
    expect(await de(ID.carlos, "select id from bookings where barbershop_id = $1", [lojaB])).toHaveLength(2)
    expect(await um(ID.carlos, "select my_professional($1)", [lojaB])).toBe(card.carlosB)
    expect((await sql("select ativo, profile_id from professionals where id = $1", [card.carlosB]))[0]).toEqual({ ativo: true, profile_id: ID.carlos })
  })

  it("7. reservas futuras ficam com a barbearia: a gestão vê e reagenda; ninguém marca horário novo no card de quem saiu", async () => {
    const futura = (await de(ID.dono, "select status, professional_id, inicio from bookings where id = $1", [reserva.futuraCarlos]))[0]
    expect(futura).toMatchObject({ professional_id: card.carlosA })
    expect(["pendente", "confirmado"]).toContain(futura.status)
    expect(await livres(lojaA, corteA, card.carlosA)).toHaveLength(0)
    const outro = (await livres(lojaA, corteA, card.biaA))[2]
    expect(await falha(ID.joao, "select create_booking($1, $2, $3, $4, 'João Silva', '64981112222', true, false, null)", [lojaA, corteA, card.carlosA, outro])).toMatch(/slot_taken/)
    await de(ID.dono, "select reschedule_booking($1, $2, $3)", [reserva.futuraCarlos, futura.inicio, card.biaA])
    expect((await sql("select professional_id from bookings where id = $1", [reserva.futuraCarlos]))[0].professional_id).toBe(card.biaA)
  })

  it("8. proprietário não sai nem exclui a conta por aqui; registra o pedido; gerente sai e a barbearia segue com o dono", async () => {
    expect(await falha(ID.dono, "select leave_barbershop($1)", [lojaA])).toMatch(/owner_cannot_leave/)
    expect(await falha(ID.dono, "select delete_my_account()")).toMatch(/owner_cannot_delete/)
    expect(await falha(ID.dono, "delete from memberships where profile_id = $1", [ID.dono])).toMatch(/permission denied/)
    expect(await papel(ID.dono, lojaA)).toBe("proprietario")
    expect(await sql("select 1 from auth.users where id = $1", [ID.dono])).toHaveLength(1)

    const pedido = await um(ID.dono, "select request_account_deletion()")
    expect(pedido).toMatchObject({ status: "pendente", bloqueios: ["proprietario"] })
    expect((await um(ID.dono, "select request_account_deletion()")).id).toBe(pedido.id)
    expect(await de(ID.dono, "select id from account_deletion_requests")).toEqual([{ id: pedido.id }])
    expect(await de(ID.maria, "select id from account_deletion_requests")).toHaveLength(0)
    expect(await falha(ID.dono, "update account_deletion_requests set status = 'cancelado'")).toMatch(/permission denied/)

    expect(await um(ID.gerente, "select leave_barbershop($1)", [lojaA])).toEqual({ status: "saiu", reservas_futuras: 0 })
    expect(await papel(ID.gerente, lojaA)).toBeNull()
    expect((await sql("select owner_id from barbershops where id = $1", [lojaA]))[0].owner_id).toBe(ID.dono)
  })

  it("9. a sessão antiga não recupera privilégios: o convite antigo expirou e o token não carrega papel", async () => {
    expect(await falha(ID.carlos, "select accept_invite('convite-antigo-carlos')")).toMatch(/invalid_invite/)
    expect(await papel(ID.carlos, lojaA)).toBeNull()
    expect(await de(ID.carlos, "select 1 from bookings where barbershop_id = $1", [lojaA])).toHaveLength(0)
  })

  it("10. saídas repetidas e simultâneas: uma só saída, um só registro, nada corrompido", async () => {
    const r = await Promise.all(Array.from({ length: 6 }, () => um(ID.rafa, "select leave_barbershop($1)", [lojaA])))
    expect(r.filter((x) => x.status === "saiu")).toHaveLength(1)
    expect(r.filter((x) => x.status === "ja_saiu")).toHaveLength(5)
    expect(await sql("select 1 from audit_logs where acao = 'member.left' and profile_id = $1", [ID.rafa])).toHaveLength(1)
    expect((await sql("select ativo, profile_id from professionals where id = $1", [card.rafaA]))[0]).toEqual({ ativo: false, profile_id: null })
  })

  it("5. o histórico financeiro fica íntegro (pagamentos, estornos, comissões, repasses e razão iguais, card com o nome)", async () => {
    expect(await financeiro()).toBe(financeiroAntes)
    expect(await sql("select 1 from commissions where professional_id = $1", [card.carlosA])).toHaveLength(1)
    expect((await sql("select nome from professionals where id = $1", [card.carlosA]))[0].nome).toBe("Carlos")
  })

  it("card de quem saiu não volta a receber reservas sem conta; um novo convite aceito religa o mesmo card", async () => {
    expect(await falha(ID.dono, "select save_professional($1, $2, 'Carlos', true, $3)", [lojaA, card.carlosA, [corteA]])).toMatch(/professional_left/)
    expect((await sql("select ativo from professionals where id = $1", [card.carlosA]))[0].ativo).toBe(false)
    await um(ID.carlos, "select accept_invite($1)", [await um(ID.dono, "select create_invite($1, $2, 'barbeiro')", [lojaA, EMAIL("carlos")])])
    expect((await sql("select profile_id, desligado_em from professionals where id = $1", [card.carlosA]))[0]).toEqual({ profile_id: ID.carlos, desligado_em: null })
    await de(ID.dono, "select save_professional($1, $2, 'Carlos', true, $3)", [lojaA, card.carlosA, [corteA]])
    expect(await um(ID.carlos, "select my_professional($1)", [lojaA])).toBe(card.carlosA)
  })
})

describe("excluir minha conta (0057)", () => {
  it("exige login recente: sem amr, login antigo ou só renovação do token → reauth_required, e nada muda", async () => {
    expect(await falha(ID.duda, "select delete_my_account()", [], [])).toMatch(/reauth_required/)
    expect(await falha(ID.duda, "select delete_my_account()", [], [{ method: "password", timestamp: agora() - 3600 }])).toMatch(/reauth_required/)
    expect(await falha(ID.duda, "select delete_my_account()", [], [{ method: "password", timestamp: agora() - 7200 }, { method: "token_refresh", timestamp: agora() }])).toMatch(/reauth_required/)
    // Revisão independente (A1): MFA cadastrado com a sessão já aberta e horário no futuro não provam quem é a pessoa.
    expect(await falha(ID.duda, "select delete_my_account()", [], [{ method: "password", timestamp: agora() - 7200 }, { method: "totp", timestamp: agora() }])).toMatch(/reauth_required/)
    expect(await falha(ID.duda, "select delete_my_account()", [], [{ method: "mfa/totp", timestamp: agora() }])).toMatch(/reauth_required/)
    expect(await falha(ID.duda, "select delete_my_account()", [], [{ method: "password", timestamp: agora() + 365 * 86400 }])).toMatch(/reauth_required/)
    expect(await falha(ID.duda, "select delete_my_account()", [], [{ timestamp: agora() } as any])).toMatch(/reauth_required/)
    expect(await sql("select 1 from auth.users where id = $1", [ID.duda])).toHaveLength(1)
    expect((await sql("select profile_id from professionals where id = $1", [card.dudaA]))[0].profile_id).toBe(ID.duda)
  })

  it("11. a conta que também é cliente: com reserva futura como cliente não exclui, mas registra o pedido", async () => {
    expect(await falha(ID.duda, "select delete_my_account()")).toMatch(/has_upcoming_bookings/)
    expect(await um(ID.duda, "select request_account_deletion()")).toMatchObject({ status: "pendente", bloqueios: ["reservas_futuras"] })
    expect((await sql("select profile_id from professionals where id = $1", [card.dudaA]))[0].profile_id).toBe(ID.duda)
    expect(await papel(ID.duda, lojaA)).toBe("barbeiro")
  })

  let outrosAntes = ""
  const outros = async () => JSON.stringify(await sql(`select
    (select jsonb_agg(to_jsonb(p) order by p.id) from professionals p where p.id <> $1) cards,
    (select jsonb_agg(to_jsonb(b) order by b.id) from bookings b where b.id <> $2) reservas,
    (select jsonb_agg(to_jsonb(m) order by m.id) from memberships m where m.profile_id <> $3) vinculos,
    (select jsonb_agg(to_jsonb(u) order by u.id) from auth.users u where u.id <> $3) contas`, [card.dudaA, reserva.dudaCliente, ID.duda]))

  it("6. a exclusão apaga o que não precisa ficar e conserva só o necessário, sem identificar a pessoa", async () => {
    await atendida(reserva.dudaCliente)
    outrosAntes = await outros()
    const pedido = (await sql("select id from account_deletion_requests where profile_id = $1 and status = 'pendente'", [ID.duda]))[0].id
    await de(ID.duda, "select delete_my_account()")

    expect(await sql("select 1 from auth.users where id = $1", [ID.duda])).toHaveLength(0)
    expect(await sql("select 1 from profiles where id = $1", [ID.duda])).toHaveLength(0)
    expect(await sql("select 1 from memberships where profile_id = $1", [ID.duda])).toHaveLength(0)
    expect((await sql("select ativo, profile_id, avatar_path, telefone, email, nome, documento, desligado_em is not null desligado from professionals where id = $1", [card.dudaA]))[0])
      .toEqual({ ativo: false, profile_id: null, avatar_path: null, telefone: null, email: null, nome: "Duda", documento: "52998224725", desligado: true })
    expect((await sql("select customer_id, cliente_nome, cliente_whatsapp, cliente_email from bookings where id = $1", [reserva.dudaCliente]))[0])
      .toEqual({ customer_id: null, cliente_nome: "Cliente removido", cliente_whatsapp: "", cliente_email: null })
    expect((await sql("select professional_id, cliente_nome from bookings where id = $1", [reserva.passadaDuda]))[0]).toEqual({ professional_id: card.dudaA, cliente_nome: "João Silva" })
    expect(await sql("select 1 from commissions where professional_id = $1", [card.dudaA])).toHaveLength(1)
    expect(await sql("select 1 from invites where lower(email) = $1", [EMAIL("duda")])).toHaveLength(0)
    expect(await sql("select 1 from invites where token_hash = $1", [await hash("convite-duda-norte")])).toHaveLength(0)
    expect(await sql("select 1 from invites where barbershop_id = $1 and email = 'removido' and aceito_em is not null", [lojaA])).toHaveLength(1)
    expect((await sql("select status, profile_id, concluido_em is not null concluido from account_deletion_requests where id = $1", [pedido]))[0])
      .toEqual({ status: "concluido", profile_id: null, concluido: true })
    expect(await sql("select profile_id, detalhes->>'origem' o from audit_logs where acao = 'member.left' and detalhes->>'origem' = 'conta_excluida'")).toEqual([{ profile_id: null, o: "conta_excluida" }])
    expect(await financeiro()).toBe(financeiroAntes)
  })

  it("12. dados de outros clientes, profissionais e contas não mudam", async () => {
    expect(await outros()).toBe(outrosAntes)
    expect((await sql("select telefone from professionals where id = $1", [card.biaA]))[0].telefone).toBe("64988887777")
  })

  it("quem saiu antes e depois exclui a conta: o card antigo também fica sem foto, telefone e e-mail, e o e-mail sai dos registros de convite", async () => {
    expect(await sql("select 1 from audit_logs where acao like 'invite.%' and detalhes->>'email' = $1", [EMAIL("rafa")])).not.toHaveLength(0)
    await de(ID.rafa, "select delete_my_account()")
    expect((await sql("select profile_id, nome, avatar_path, telefone, email, ativo from professionals where id = $1", [card.rafaA]))[0])
      .toEqual({ profile_id: null, nome: "Rafa", avatar_path: null, telefone: null, email: null, ativo: false })
    expect(await sql("select 1 from audit_logs where detalhes::text ilike $1", [`%${EMAIL("rafa")}%`])).toHaveLength(0)
    expect((await sql("select telefone, email from professionals where id = $1", [card.biaA]))[0]).toEqual({ telefone: "64988887777", email: EMAIL("bia") })
  })

  it("9 e 10. o token antigo da conta excluída não recupera nada; repetir a exclusão não muda nada", async () => {
    const contas = (await sql("select count(*)::int n from auth.users"))[0].n
    expect(await falha(ID.duda, "select delete_my_account()")).toBeNull()
    expect((await sql("select count(*)::int n from auth.users"))[0].n).toBe(contas)
    expect(await de(ID.duda, "select 1 from bookings")).toHaveLength(0)
    expect(await um(ID.duda, "select my_professional($1)", [lojaA])).toBeNull()
    expect(await um(ID.duda, "select leave_barbershop($1)", [lojaA])).toEqual({ status: "ja_saiu", reservas_futuras: 0 })
    expect(await falha(ID.duda, "select request_account_deletion()")).toMatch(/not_authenticated/)
    const vaga = (await livres(lojaB, corteB, card.carlosB))[6]
    expect(await falha(ID.duda, "select create_booking($1, $2, $3, $4, 'Duda', '64992750733', true, false, null)", [lojaB, corteB, card.carlosB, vaga])).not.toBeNull()
    expect(await sql("select 1 from profiles where id = $1", [ID.duda])).toHaveLength(0)
  })

  it("travas da exclusão na ordem do aceite de convite (convite → perfil → card): sem impasse nem card ativo órfão", async () => {
    // Prova com várias conexões em PostgreSQL real: evidencias/execucao/concorrencia-0057.pg.mjs.txt (cenários 1 a 3).
    const def = (await sql("select pg_get_functiondef('public.delete_my_account()'::regprocedure) d"))[0].d as string
    const convite = def.indexOf("from public.invites i where v_email is not null and lower(btrim(i.email)) = v_email for update")
    const perfil = def.indexOf("from public.profiles p where p.id = v_uid for update")
    const cards = def.indexOf("from public.professionals p where p.profile_id = v_uid for update")
    expect(convite).toBeGreaterThan(0)
    expect(perfil).toBeGreaterThan(convite)
    expect(cards).toBeGreaterThan(perfil)
  })

  it("visitante sem login não chama nenhuma das funções novas", async () => {
    for (const f of ["leave_barbershop($1)", "get_leave_summary($1)"]) expect(await falha(null, `select ${f}`, [lojaA])).toMatch(/permission denied/)
    expect(await falha(null, "select request_account_deletion()")).toMatch(/permission denied/)
    expect(await falha(null, "select delete_my_account()")).toMatch(/permission denied/)
  })
})
