/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Agenda própria do barbeiro e vínculo profissional ↔ conta (F06-03, F06-06) em PostgreSQL local (PGlite).
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite({ extensions: { btree_gist } })
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), donoB: U("b1"), barb1: U("c1"), barb2: U("c2"), barb3: U("c3"), cli1: U("d1"), cli2: U("d2") }
let loja = "", lojaB = "", corte = "", ana = "", bia = "", reservaAna = "", reservaBia = ""

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

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `)
  for (const f of ["0001_identidade_inicial", "0002_catalogo", "0003_agenda", "0004_barbeiro"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])

  loja = await val(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")
  lojaB = await val(ID.donoB, "select create_barbershop('Barbearia B', 'barbearia-b')")
  for (const b of [ID.barb1, ID.barb2, ID.barb3]) await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'barbeiro')", [loja, b])
  corte = (await rows(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [loja]))[0].id
  ana = await val(ID.dono, "select save_professional($1, null, 'Ana', true, $2)", [loja, [corte]])
  bia = await val(ID.dono, "select save_professional($1, null, 'Bia', true, $2)", [loja, [corte]])
  const semana = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))
  for (const p of [ana, bia]) await rows(ID.dono, "select save_working_hours($1, $2)", [p, semana])

  const dia = await val(null, "select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text")
  const slots = await rows(null, "select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, null, dia])
  const reservar = (user: string, prof: string, ini: string) =>
    val(user, "select create_booking($1, $2, $3, $4, 'Cliente', '11912345678', false, false, null)", [loja, corte, prof, ini])
  reservaAna = await reservar(ID.cli1, ana, slots[0].slot_inicio)
  reservaBia = await reservar(ID.cli2, bia, slots[0].slot_inicio)
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("vínculo entre profissional e conta", () => {
  it("só a gestão vincula, e só quem já é barbeiro da barbearia", async () => {
    await expect(val(ID.barb1, "select link_professional($1, $2)", [ana, ID.barb1])).rejects.toThrow(/forbidden/)
    await expect(val(ID.donoB, "select link_professional($1, $2)", [ana, ID.barb1])).rejects.toThrow(/forbidden/)
    await expect(val(ID.dono, "select link_professional($1, $2)", [ana, ID.cli1])).rejects.toThrow(/invalid_profile/)
    await expect(val(ID.dono, "select link_professional($1, $2)", [ana, ID.donoB])).rejects.toThrow(/invalid_profile/)
    await rows(ID.dono, "select link_professional($1, $2)", [ana, ID.barb1])
    await rows(ID.dono, "select link_professional($1, $2)", [bia, ID.barb2])
  })

  it("uma conta não fica ligada a dois profissionais", async () => {
    await expect(val(ID.dono, "select link_professional($1, $2)", [bia, ID.barb1])).rejects.toThrow(/already_linked/)
  })

  it("a gestão lista os vínculos; os demais não", async () => {
    const links = await rows(ID.dono, "select professional_id, profile_id from get_team_links($1)", [loja])
    expect(links.map((l) => [l.professional_id, l.profile_id]).sort()).toEqual([[ana, ID.barb1], [bia, ID.barb2]].sort())
    for (const u of [ID.barb1, ID.cli1, ID.donoB]) expect(await rows(u, "select 1 from get_team_links($1)", [loja])).toHaveLength(0)
  })

  it("o profile_id não é legível por clientes nem por colegas", async () => {
    for (const u of [ID.cli1, ID.barb1, ID.dono]) {
      await expect(rows(u, "select profile_id from professionals")).rejects.toThrow(/permission denied/)
      expect((await rows(u, "select id, nome from professionals")).length).toBeGreaterThan(0)
    }
  })
})

describe("F06-03: o barbeiro vê e atende só a própria agenda", () => {
  it("cada barbeiro lê apenas as reservas do profissional ligado à sua conta", async () => {
    expect((await rows(ID.barb1, "select id from bookings")).map((r) => r.id)).toEqual([reservaAna])
    expect((await rows(ID.barb2, "select id from bookings")).map((r) => r.id)).toEqual([reservaBia])
    expect(await rows(ID.barb3, "select 1 from bookings")).toHaveLength(0)
    expect(await rows(ID.donoB, "select 1 from bookings")).toHaveLength(0)
  })

  it("lê só os bloqueios do próprio profissional", async () => {
    const ini = new Date(Date.now() + 5 * 86_400_000).toISOString()
    const fim = new Date(Date.now() + 5 * 86_400_000 + 3600_000).toISOString()
    await val(ID.dono, "select create_block($1, $2, $3, $4, 'Folga')", [loja, ana, ini, fim])
    expect(await rows(ID.barb1, "select 1 from occupancies where kind = 'block'")).toHaveLength(1)
    expect(await rows(ID.barb2, "select 1 from occupancies where kind = 'block'")).toHaveLength(0)
  })

  it("conclui ou marca falta só nos próprios atendimentos, depois do horário", async () => {
    await expect(val(ID.barb1, "select set_booking_status($1, 'concluido')", [reservaAna])).rejects.toThrow(/invalid_status/)
    await db.query("update bookings set inicio = now() - interval '2 hours', fim = now() - interval '80 minutes' where id = any($1)", [[reservaAna, reservaBia]])
    await expect(val(ID.barb1, "select set_booking_status($1, 'concluido')", [reservaBia])).rejects.toThrow(/forbidden/)
    await expect(val(ID.barb3, "select set_booking_status($1, 'concluido')", [reservaAna])).rejects.toThrow(/forbidden/)
    await rows(ID.barb1, "select set_booking_status($1, 'concluido')", [reservaAna])
    expect(await val(ID.dono, "select status from bookings where id = $1", [reservaAna])).toBe("concluido")
  })

  it("não cancela, não confirma e não cria bloqueios", async () => {
    await expect(val(ID.barb2, "select cancel_booking($1)", [reservaBia])).rejects.toThrow(/forbidden/)
    await expect(val(ID.barb2, "select set_booking_status($1, 'confirmado')", [reservaBia])).rejects.toThrow(/forbidden/)
    await expect(val(ID.barb2, "select create_block($1, $2, now() + interval '9 days', now() + interval '9 days 1 hour', null)", [loja, bia])).rejects.toThrow(/forbidden/)
  })

  it("a gestão continua vendo tudo, e desvincular tira o acesso do barbeiro", async () => {
    expect(await rows(ID.dono, "select 1 from bookings")).toHaveLength(2)
    await rows(ID.dono, "select link_professional($1, null)", [ana])
    expect(await rows(ID.barb1, "select 1 from bookings")).toHaveLength(0)
    await expect(val(ID.barb1, "select set_booking_status($1, 'nao_compareceu')", [reservaAna])).rejects.toThrow(/forbidden/)
    void lojaB
  })
})
