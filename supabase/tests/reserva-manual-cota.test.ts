/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Reserva manual e fila do WhatsApp (P6): antes da 0045 a gestão de uma barbearia criava reservas manuais sem limite e a fila
// era entregue em ordem global, então o volume de uma barbearia ocupava a vez das outras. Agora: cota de 300 reservas manuais
// por barbearia em 24 h e revezamento por barbearia na fila.
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
const loja: Record<"A" | "B", { id: string; corte: string; ana: string; slots: string[] }> = {} as any
let seq = 0
let antes: { manual_sem_cota: boolean; b_no_primeiro_lote: boolean } | null = null

const sql = async (q: string, p: unknown[] = []) => (await db.query<Record<string, any>>(q, p)).rows
async function como(user: string, q: string, p: unknown[] = []) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user])
  await db.exec("set role authenticated")
  try { return await sql(q, p) } finally { await db.exec("reset role") }
}
const manual = (chave: "A" | "B", dono: string, chaveIdem: string | null = null) =>
  como(dono, "select create_manual_booking($1, $2, $3, $4, 'Maria', '64992750733', true, $5) id", [loja[chave].id, loja[chave].corte, loja[chave].ana, loja[chave].slots.shift(), chaveIdem])
/** Simula N reservas manuais já criadas hoje (eventos 'created' de origem manual), sem ocupar a agenda do teste. */
async function jaCriadasHoje(chave: "A" | "B", reserva: string, n: number, horasAtras = 1) {
  await sql("insert into booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes, criado_em) select $1, $2, null, 'created', '{\"origem\":\"manual\"}', now() - make_interval(hours => $4::int) from generate_series(1, $3::int)", [reserva, loja[chave].id, n, horasAtras])
}
async function enfileirar(shop: string, n: number, minutosAtras: number) {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const [r] = await sql("insert into outbox_events (barbershop_id, tipo, destino, payload, dedup_key, proximo_envio) values ($1, 'reserva_confirmada', $2, '{}', $3, now() - make_interval(mins => $4::int)) returning id",
      [shop, `6499${String(++seq).padStart(7, "0")}`, `fila-${seq}`, minutosAtras])
    ids.push(r.id)
  }
  return ids
}
const reivindicar = async () => (await sql("select id, barbershop_id from claim_whatsapp_outbox(20)")).map((r) => ({ id: r.id as string, loja: r.barbershop_id as string }))

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } })
  await db.exec(AMBIENTE)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql") && x < "0045").sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  for (const [chave, dono] of [["A", ID.donoA], ["B", ID.donoB]] as const) {
    const id = (await como(dono, `select create_barbershop('Barbearia ${chave}', 'barbearia-${chave.toLowerCase()}') id`))[0].id
    const corte = (await como(dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [id]))[0].id
    const ana = (await como(dono, "select save_professional($1, null, 'Ana', true, $2) id", [id, [corte]]))[0].id
    await como(dono, "select save_working_hours($1, $2)", [ana, JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 480, fim_min: 1260 })))])
    await sql("insert into integration_accounts (barbershop_id, provider, status, evolution_instance_name) values ($1, 'whatsapp', 'ativo', $2)", [id, `inst_${chave}`])
    const dia = (await sql("select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text d"))[0].d
    const slots = (await sql("select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [id, corte, ana, dia])).map((s) => s.slot_inicio).filter((_, i) => i % 4 === 0)
    loja[chave] = { id, corte, ana, slots }
  }

  // Antes da 0045: 300 reservas manuais "de hoje" e mais uma passa; 40 avisos antigos de A e 1 de B: o 1º lote é todo de A.
  const [primeira] = await manual("A", ID.donoA)
  await jaCriadasHoje("A", primeira.id, 300)
  let manualSemCota = true
  try { await manual("A", ID.donoA) } catch { manualSemCota = false }
  await sql("delete from outbox_events")
  await enfileirar(loja.A.id, 40, 30)
  const [b] = await enfileirar(loja.B.id, 1, 0)
  antes = { manual_sem_cota: manualSemCota, b_no_primeiro_lote: (await reivindicar()).some((r) => r.id === b) }
  await sql("delete from outbox_events")
  await db.exec(readFileSync("supabase/migrations/0045_reserva_manual_cota_fila_justa.sql", "utf8"))
}, 180_000)

afterAll(async () => {
  await db.close()
})

describe("reserva manual com cota e fila com revezamento (0045)", () => {
  it("antes da 0045: reserva manual sem limite e a fila do WhatsApp sem revezamento entre barbearias", () => {
    expect(antes).toEqual({ manual_sem_cota: true, b_no_primeiro_lote: false })
  })

  it("a 301ª reserva manual em 24 h é recusada; a outra barbearia e o dia seguinte não são afetados", async () => {
    await expect(manual("A", ID.donoA)).rejects.toThrow(/manual_booking_limit/)
    expect((await manual("B", ID.donoB))[0].id).toBeTruthy()
    await sql("update booking_events set criado_em = now() - interval '25 hours' where barbershop_id = $1", [loja.A.id])
    expect((await manual("A", ID.donoA))[0].id).toBeTruthy()
  })

  it("repetir a mesma reserva (mesma chave) devolve a existente sem gastar cota; abaixo do limite tudo segue normal", async () => {
    const [a] = await manual("B", ID.donoB, "chave-1")
    const total = Number((await sql("select count(*)::int n from booking_events where barbershop_id = $1 and tipo = 'created'", [loja.B.id]))[0].n)
    const [b] = await manual("B", ID.donoB, "chave-1")
    expect(b.id).toBe(a.id)
    expect(Number((await sql("select count(*)::int n from booking_events where barbershop_id = $1 and tipo = 'created'", [loja.B.id]))[0].n)).toBe(total)
  })

  it("fila: o 1º lote reveza entre as barbearias (a confirmação de B sai junto com as de A) e mantém a ordem dentro de cada uma", async () => {
    await sql("delete from outbox_events")
    await enfileirar(loja.A.id, 40, 30)
    const [b] = await enfileirar(loja.B.id, 1, 0)
    const deA = (await sql("select id from outbox_events where barbershop_id = $1 order by proximo_envio, id", [loja.A.id])).map((r) => r.id as string)
    const lote = await reivindicar()
    expect(lote).toHaveLength(20)
    expect(lote.map((r) => r.id)).toContain(b)
    expect(new Set(lote.filter((r) => r.loja === loja.A.id).map((r) => r.id))).toEqual(new Set(deA.slice(0, 19)))
    expect(new Set((await reivindicar()).map((r) => r.id))).toEqual(new Set(deA.slice(19, 39)))
  })
})

describe("versão antiga de create_manual_booking (8 parâmetros) que só existe no remoto (0048)", () => {
  // Mesma assinatura e mesmos nomes de parâmetros da sobra do remoto; o corpo antigo não tinha a cota.
  const SOBRA = `create function public.create_manual_booking(p_barbershop_id uuid, p_service_id uuid, p_professional_id uuid, p_inicio timestamptz,
    p_nome text, p_whatsapp text, p_consent_lembretes boolean, p_idempotency_key text) returns uuid language sql security definer set search_path = ''
    as $$ select gen_random_uuid() $$; grant execute on function public.create_manual_booking(uuid, uuid, uuid, timestamptz, text, text, boolean, text) to authenticated;`
  const versoes = async () => Number((await sql("select count(*)::int n from pg_proc where proname = 'create_manual_booking'"))[0].n)
  /** Chamada por nome sem p_email (como a API aceitaria) e chamada do app (9 parâmetros, com p_email). */
  const sem = () => como(ID.donoA, "select create_manual_booking(p_barbershop_id => $1, p_service_id => $2, p_professional_id => $3, p_inicio => $4, p_nome => 'Maria', p_whatsapp => '64992750733', p_consent_lembretes => true, p_idempotency_key => null) id",
    [loja.A.id, loja.A.corte, loja.A.ana, loja.A.slots[0]]).then(() => "aceitou", (e: Error) => e.message)
  const doApp = () => como(ID.donoA, "select create_manual_booking(p_barbershop_id => $1, p_service_id => $2, p_professional_id => $3, p_inicio => $4, p_nome => 'Maria', p_whatsapp => '64992750733', p_consent_lembretes => true, p_idempotency_key => null, p_email => null) id",
    [loja.A.id, loja.A.corte, loja.A.ana, loja.A.slots[0]]).then(() => "aceitou", (e: Error) => e.message)

  it("antes: a sobra deixava a chamada sem p_email ambígua (nunca passava da cota); depois da 0048 só resta a versão com cota", async () => {
    const reserva = (await sql("select id from bookings where barbershop_id = $1 limit 1", [loja.A.id]))[0].id
    await jaCriadasHoje("A", reserva, 300)
    await db.exec(SOBRA)
    expect(await versoes()).toBe(2)
    const antes = { sem_email: await sem(), app: await doApp() }
    expect(antes.app).toMatch(/manual_booking_limit/)
    expect(antes.sem_email).toMatch(/is not unique/) // hoje a sobra não é alcançável: a chamada fica ambígua (não é contorno)

    await db.exec(readFileSync("supabase/migrations/0048_reserva_manual_sobrecarga_antiga.sql", "utf8"))
    expect(await versoes()).toBe(1)
    expect(await sem()).toMatch(/manual_booking_limit/)
    expect(await doApp()).toMatch(/manual_booking_limit/)
    await db.exec(readFileSync("supabase/migrations/0048_reserva_manual_sobrecarga_antiga.sql", "utf8")) // sem a sobra: não faz nada
    expect(await versoes()).toBe(1)
  })
})
