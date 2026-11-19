/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Estorno × repasse simultâneos (0042) em PostgreSQL local (PGlite). Uma conexão só não roda duas transações ao mesmo tempo,
// então a intercalação é feita por gatilhos de teste, no ponto exato em que a outra operação confirmaria no meio:
//   agenda A: o repasse acontece depois de o estorno ler a comissão e antes de cancelá-la;
//   agenda B: o estorno acontece depois de o repasse somar as comissões e antes de liquidá-las.
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite({ extensions: { btree_gist } })
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), barbeiro: U("b1"), cliente: U("c1") }
let loja = "", corte = "", ana = "", slots: string[] = [], proximo = 0
let antes: { comissao: string; repasse_sem_comissao: boolean } | null = null

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
const agenda = (nome: "" | "A" | "B") => db.query("select set_config('teste.agenda', $1, false)", [nome])

/** Atendimento concluído (comissão de 40% provisionada) com pagamento de 6000 confirmado. */
async function atendimento() {
  const reserva = await val(ID.cliente, "select create_booking($1, $2, $3, $4, 'Maria', '64992750733', false, false, null)", [loja, corte, ana, slots[proximo++]])
  await db.query("update bookings set inicio = now() - interval '3 hours', fim = now() - interval '140 minutes' where id = $1", [reserva])
  await rows(ID.dono, "select set_booking_status($1, 'concluido')", [reserva])
  const pagamento = await val(ID.dono, "select register_payment($1, 6000, 'pix', 1, $2)", [reserva, `pag-${reserva}`])
  await rows(ID.dono, "select confirm_payment($1)", [pagamento])
  return { reserva, pagamento }
}
const comissao = async (reserva: string) => (await db.query<{ status: string; payout_id: string | null }>("select status, payout_id from commissions where booking_id = $1", [reserva])).rows[0]
const repassesSemComissao = async () =>
  Number((await db.query<{ n: number }>("select count(*)::int n from payouts p where p.valor_centavos <> coalesce((select sum(c.valor_centavos) from commissions c where c.payout_id = p.id and c.status = 'liquidada'), 0)")).rows[0].n)
const estornar = (pagamento: string, chave: string) => val(ID.dono, "select refund_payment($1, 6000, 'teste', $2)", [pagamento, chave])
const repassar = (chave: string) => val(ID.dono, "select create_payout($1, $2)", [ana, chave])

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `)
  for (const f of ["0001_identidade_inicial", "0002_catalogo", "0003_agenda", "0004_barbeiro", "0005_financeiro"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  loja = await val(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")
  corte = (await rows(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [loja]))[0].id
  ana = await val(ID.dono, "select save_professional($1, null, 'Ana', true, $2)", [loja, [corte]])
  await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'barbeiro')", [loja, ID.barbeiro])
  await rows(ID.dono, "select link_professional($1, $2)", [ana, ID.barbeiro])
  await rows(ID.dono, "select save_commission_rule($1, null, null, 'percentual', 4000)", [loja])
  await rows(ID.dono, "select save_working_hours($1, $2)", [ana, JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 480, fim_min: 1260 })))])
  const dia = await val(null, "select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text")
  slots = (await rows(null, "select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, ana, dia])).map((s) => s.slot_inicio).filter((_, i) => i % 4 === 0)

  // Gatilhos de teste que intercalam a outra operação no ponto crítico (só quando teste.agenda pede).
  await db.exec(`
    create function public.sim_repasse_no_estorno() returns trigger language plpgsql as $f$
    begin
      if new.tipo = 'estorno' and current_setting('teste.agenda', true) = 'A' then
        perform set_config('teste.agenda', '', false);
        perform public.create_payout((select professional_id from public.bookings where id = new.booking_id), 'repasse-' || new.ref_id);
      end if;
      return new;
    end $f$;
    create trigger sim_a after insert on public.financial_ledger for each row execute function public.sim_repasse_no_estorno();
    create function public.sim_estorno_no_repasse() returns trigger language plpgsql as $f$
    begin
      if current_setting('teste.agenda', true) like 'B:%' then
        perform public.refund_payment(split_part(current_setting('teste.agenda'), ':', 2)::uuid, 6000, 'concorrente', 'estorno-' || new.id);
        perform set_config('teste.agenda', '', false);
      end if;
      return new;
    end $f$;
    create trigger sim_b after insert on public.payouts for each row execute function public.sim_estorno_no_repasse();
    grant execute on function public.sim_repasse_no_estorno(), public.sim_estorno_no_repasse() to authenticated;
  `)

  // Antes da correção (definições da 0005): na agenda A a comissão paga vira 'cancelada' e o repasse fica sem comissão.
  const a = await atendimento()
  await agenda("A")
  await estornar(a.pagamento, "estorno-antes")
  await agenda("")
  antes = { comissao: (await comissao(a.reserva)).status, repasse_sem_comissao: (await repassesSemComissao()) > 0 }

  await db.exec(readFileSync("supabase/migrations/0042_estorno_repasse_atomico.sql", "utf8"))
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("estorno × repasse simultâneos (0042)", () => {
  it("antes da 0042 a corrida quebrava as comissões (comissão paga virava cancelada e o repasse ficava sem comissão)", () => {
    expect(antes).toEqual({ comissao: "cancelada", repasse_sem_comissao: true })
  })

  it("em sequência nada muda: repasse e depois estorno → commission_settled; estorno total e depois repasse → nada a pagar", async () => {
    const um = await atendimento()
    await repassar(`seq-${um.reserva}`)
    await expect(estornar(um.pagamento, `seq-est-${um.reserva}`)).rejects.toThrow(/commission_settled/)
    expect((await comissao(um.reserva)).status).toBe("liquidada")

    const dois = await atendimento()
    await estornar(dois.pagamento, `seq2-${dois.reserva}`)
    expect((await comissao(dois.reserva)).status).toBe("cancelada")
    await expect(repassar(`seq2-rep-${dois.reserva}`)).rejects.toThrow(/nothing_to_pay/)
  })

  it("agenda A (repasse no meio do estorno): o estorno é recusado com commission_settled e nada fica gravado", async () => {
    const r = await atendimento()
    const repasses = Number(await val(ID.dono, "select count(*) from payouts"))
    await agenda("A")
    await expect(estornar(r.pagamento, `a-${r.reserva}`)).rejects.toThrow(/commission_settled/)
    await agenda("")
    expect(await comissao(r.reserva)).toEqual({ status: "provisionada", payout_id: null })
    expect(Number(await val(ID.dono, "select count(*) from payouts"))).toBe(repasses)
    expect(Number(await val(ID.dono, "select count(*) from refunds where payment_id = $1", [r.pagamento]))).toBe(0)
    expect(await repassesSemComissao()).toBe(1) // só o do caso antigo, anterior à correção
  })

  it("agenda B (estorno no meio do repasse): o repasse é recusado com payout_conflict e nada fica gravado", async () => {
    const r = await atendimento()
    const repasses = Number(await val(ID.dono, "select count(*) from payouts"))
    await agenda(`B:${r.pagamento}` as "B")
    await expect(repassar(`b-${r.reserva}`)).rejects.toThrow(/payout_conflict/)
    await agenda("")
    expect(await comissao(r.reserva)).toEqual({ status: "provisionada", payout_id: null })
    expect(Number(await val(ID.dono, "select count(*) from payouts"))).toBe(repasses)
    expect(Number(await val(ID.dono, "select count(*) from refunds where payment_id = $1", [r.pagamento]))).toBe(0)
  })

  it("depois de um conflito, refazer em sequência funciona e o valor do repasse é sempre a soma das comissões ligadas", async () => {
    const pago = await repassar("final")
    expect((await rows(ID.dono, "select status from commissions where payout_id = $1", [pago])).every((c) => c.status === "liquidada")).toBe(true)
    expect(await repassesSemComissao()).toBe(1) // só o do caso antigo
    expect(Number(await val(ID.dono, "select count(*) from commissions where status = 'cancelada' and payout_id is not null"))).toBe(1) // idem
  })
})
