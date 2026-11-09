/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Financeiro e comissões (F07-01 a F07-06; T14, T03, T02) em PostgreSQL local (PGlite).
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite({ extensions: { btree_gist } })
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), donoB: U("b1"), barb1: U("c1"), barb2: U("c2"), cli1: U("d1"), cli2: U("d2"), cli3: U("d3") }
let loja = "", lojaB = "", corte = "", ana = "", bia = ""
const reservas: string[] = []

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

async function novaReserva(cliente: string, prof: string, minutosAtras: number): Promise<string> {
  const dia = await val(null, "select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text")
  const slots = await rows(null, "select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, prof, dia])
  const usados = reservas.length
  const id = await val(cliente, "select create_booking($1, $2, $3, $4, 'Cliente', '11912345678', false, false, null)", [loja, corte, prof, slots[usados % slots.length].slot_inicio])
  await db.query("update bookings set inicio = now() - ($2 || ' minutes')::interval, fim = now() - ($2 || ' minutes')::interval + interval '40 minutes' where id = $1", [id, String(minutosAtras)])
  reservas.push(id)
  return id
}

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `)
  for (const f of ["0001_identidade_inicial", "0002_catalogo", "0003_agenda", "0004_barbeiro", "0005_financeiro"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])

  loja = await val(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")
  lojaB = await val(ID.donoB, "select create_barbershop('Barbearia B', 'barbearia-b')")
  for (const b of [ID.barb1, ID.barb2]) await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'barbeiro')", [loja, b])
  corte = (await rows(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [loja]))[0].id
  ana = await val(ID.dono, "select save_professional($1, null, 'Ana', true, $2)", [loja, [corte]])
  bia = await val(ID.dono, "select save_professional($1, null, 'Bia', true, $2)", [loja, [corte]])
  const semana = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))
  for (const p of [ana, bia]) await rows(ID.dono, "select save_working_hours($1, $2)", [p, semana])
  await rows(ID.dono, "select link_professional($1, $2)", [ana, ID.barb1])
  await rows(ID.dono, "select link_professional($1, $2)", [bia, ID.barb2])
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("F07-03: regra de comissão congelada no atendimento", () => {
  let r1 = "", r2 = ""
  it("só a gestão da própria barbearia define regras; percentual em pontos-base e valor fixo em centavos", async () => {
    await expect(val(ID.barb1, "select save_commission_rule($1, null, null, 'percentual', 4000)", [loja])).rejects.toThrow(/forbidden/)
    await expect(val(ID.donoB, "select save_commission_rule($1, null, null, 'percentual', 4000)", [loja])).rejects.toThrow(/forbidden/)
    await expect(val(ID.dono, "select save_commission_rule($1, null, null, 'percentual', 10001)", [loja])).rejects.toThrow(/invalid_rule/)
    await expect(val(ID.dono, "select save_commission_rule($1, null, null, 'fixo', -1)", [loja])).rejects.toThrow(/invalid_rule/)
    await expect(val(ID.dono, "select save_commission_rule($1, $2, null, 'percentual', 5000)", [loja, lojaB])).rejects.toThrow() // profissional de outra empresa
    await rows(ID.dono, "select save_commission_rule($1, null, null, 'percentual', 4000)", [loja]) // padrão da loja: 40%
    await rows(ID.dono, "select save_commission_rule($1, $2, $3, 'fixo', 2500)", [loja, bia, corte]) // Bia + Corte: R$ 25,00
  })

  it("a regra mais específica vence; ao concluir, a comissão fica congelada", async () => {
    r1 = await novaReserva(ID.cli1, ana, 120)
    r2 = await novaReserva(ID.cli2, bia, 100)
    await rows(ID.barb1, "select set_booking_status($1, 'concluido')", [r1])
    await rows(ID.barb2, "select set_booking_status($1, 'concluido')", [r2])
    const c = await rows(ID.dono, "select booking_id, valor_centavos, regra_tipo, regra_valor, status from commissions order by valor_centavos")
    expect(c.map((x) => [x.booking_id, x.valor_centavos, x.regra_tipo, x.regra_valor, x.status])).toEqual([
      [r2, 2500, "fixo", 2500, "provisionada"],
      [r1, 2400, "percentual", 4000, "provisionada"],
    ].sort((a, b) => (a[1] as number) - (b[1] as number)))
    // mudar a regra depois não reescreve a comissão já congelada
    await rows(ID.dono, "select save_commission_rule($1, null, null, 'percentual', 9000)", [loja])
    expect(await val(ID.dono, "select valor_centavos from commissions where booking_id = $1", [r1])).toBe(2400)
  })

  it("no show não gera comissão; concluir de novo não duplica", async () => {
    const r3 = await novaReserva(ID.cli3, ana, 90)
    await rows(ID.barb1, "select set_booking_status($1, 'nao_compareceu')", [r3])
    expect(await rows(ID.dono, "select 1 from commissions where booking_id = $1", [r3])).toHaveLength(0)
    await expect(val(ID.barb1, "select set_booking_status($1, 'concluido')", [r1])).rejects.toThrow(/invalid_status/)
    expect(await rows(ID.dono, "select 1 from commissions")).toHaveLength(2)
  })
})

describe("F07-01/02/05: pagamentos declarados e idempotentes (T14)", () => {
  let pay = ""
  it("só a gestão registra; reserva não concluída ou de outra empresa é recusada", async () => {
    await expect(val(ID.barb1, "select register_payment($1, 6000, 'pix', 1, 'k-1')", [reservas[0]])).rejects.toThrow(/forbidden/)
    await expect(val(ID.donoB, "select register_payment($1, 6000, 'pix', 1, 'k-1')", [reservas[0]])).rejects.toThrow(/forbidden/)
    await expect(val(ID.dono, "select register_payment($1, 6000, 'cheque', 1, 'k-1')", [reservas[0]])).rejects.toThrow(/invalid_payment/)
    await expect(val(ID.dono, "select register_payment($1, 0, 'pix', 1, 'k-1')", [reservas[0]])).rejects.toThrow(/invalid_payment/)
    await expect(val(ID.dono, "select register_payment($1, 6000, 'pix', 13, 'k-1')", [reservas[0]])).rejects.toThrow(/invalid_payment/)
    await expect(val(ID.dono, "select register_payment($1, 6000, 'pix', 1, 'k-1')", [reservas[2]])).rejects.toThrow(/booking_not_payable/)
  })

  it("repetir a mesma chave devolve o mesmo pagamento, sem duplicar", async () => {
    const ids = await Promise.all(Array.from({ length: 8 }, () => val(ID.dono, "select register_payment($1, 6000, 'pix', 1, 'k-pix')", [reservas[0]])))
    pay = ids[0]
    expect(new Set(ids).size).toBe(1)
    expect(await rows(ID.dono, "select 1 from payments where booking_id = $1", [reservas[0]])).toHaveLength(1)
    await expect(val(ID.dono, "select register_payment($1, 5000, 'pix', 1, 'k-pix')", [reservas[0]])).rejects.toThrow(/idempotency_conflict/)
  })

  it("não aceita receber mais que o valor da reserva", async () => {
    await expect(val(ID.dono, "select register_payment($1, 1, 'dinheiro', 1, 'k-extra')", [reservas[0]])).rejects.toThrow(/overpayment/)
    const a = await val(ID.dono, "select register_payment($1, 2000, 'dinheiro', 1, 'k-r2a')", [reservas[1]])
    await expect(val(ID.dono, "select register_payment($1, 4001, 'credito', 3, 'k-r2b')", [reservas[1]])).rejects.toThrow(/overpayment/)
    const b = await val(ID.dono, "select register_payment($1, 4000, 'credito', 3, 'k-r2b')", [reservas[1]])
    expect(await val(ID.dono, "select sum(valor_centavos)::int from payments where booking_id = $1", [reservas[1]])).toBe(6000)
    for (const id of [a, b]) await rows(ID.dono, "select confirm_payment($1)", [id])
  })

  it("estorno parcial e total, idempotente e limitado ao valor pago (só do que foi confirmado)", async () => {
    await expect(val(ID.dono, "select refund_payment($1, 1000, 'x', 'k-antes')", [pay])).rejects.toThrow(/payment_not_confirmed/)
    await rows(ID.dono, "select confirm_payment($1)", [pay])
    const e = await Promise.all(Array.from({ length: 5 }, () => val(ID.dono, "select refund_payment($1, 1000, 'cliente insatisfeito', 'k-est')", [pay])))
    expect(new Set(e).size).toBe(1)
    await expect(val(ID.dono, "select refund_payment($1, 5001, 'x', 'k-est2')", [pay])).rejects.toThrow(/over_refund/)
    await expect(val(ID.barb1, "select refund_payment($1, 100, 'x', 'k-est3')", [pay])).rejects.toThrow(/forbidden/)
    await rows(ID.dono, "select refund_payment($1, 5000, 'resto', 'k-est4')", [pay])
    expect(await val(ID.dono, "select (select coalesce(sum(valor_centavos),0) from payments where id = $1) - (select coalesce(sum(valor_centavos),0) from refunds where payment_id = $1)", [pay])).toBe(0)
  })
})

describe("pagamento após aceitar e trava de cancelamento (controle do caixa)", () => {
  it("recebe antes de concluir (reserva confirmada), mas não de reserva cancelada; a trava só libera após o estorno", async () => {
    const dia = await val(null, "select ((now() at time zone 'America/Sao_Paulo')::date + 2)::text")
    const slots = await rows(null, "select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, ana, dia])
    const futura = await val(ID.cli1, "select create_booking($1, $2, $3, $4, 'Cliente', '11912345678', false, false, null)", [loja, corte, ana, slots[0].slot_inicio])
    expect(await val(ID.dono, "select status from bookings where id = $1", [futura])).toBe("confirmado")
    const pag = await val(ID.dono, "select register_payment($1, 6000, 'pix', 1, 'k-antecipado')", [futura]) // ainda não concluída
    expect(pag).toBeTruthy()
    await expect(val(ID.dono, "select cancel_booking($1)", [futura])).rejects.toThrow(/has_payments/)
    await expect(val(ID.cli1, "select cancel_booking($1)", [futura])).rejects.toThrow(/has_payments/)
    await rows(ID.dono, "select confirm_payment($1)", [pag]) // só se estorna o que entrou no caixa
    await rows(ID.dono, "select refund_payment($1, 6000, 'cancelamento', 'k-est-antecipado')", [pag])
    await rows(ID.dono, "select cancel_booking($1)", [futura]) // estornado por inteiro: cancela
    await expect(val(ID.dono, "select register_payment($1, 100, 'pix', 1, 'k-cancelada')", [futura])).rejects.toThrow(/booking_not_payable/)
  })
})

describe("confirmação de pagamento: só entra no caixa depois de confirmado", () => {
  it("declarado fica 'a confirmar': não há lançamento no caixa nem soma no relatório; confirmar lança uma vez", async () => {
    const dia = await val(null, "select ((now() at time zone 'America/Sao_Paulo')::date + 3)::text")
    const slots = await rows(null, "select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, ana, dia])
    const r = await val(ID.cli1, "select create_booking($1, $2, $3, $4, 'Cliente', '11912345678', false, false, null)", [loja, corte, ana, slots[0].slot_inicio])
    const antes = await rows(ID.dono, "select recebido_centavos from finance_report($1, (now() - interval '2 days')::date, (now() + interval '5 days')::date)", [loja])
    const pag = await val(ID.dono, "select register_payment($1, 6000, 'pix', 1, 'k-confirmar')", [r])
    expect(await val(ID.dono, "select confirmado_em from payments where id = $1", [pag])).toBeNull()
    expect(await rows(ID.dono, "select 1 from financial_ledger where ref_id = $1", [pag])).toHaveLength(0)
    const meio = await rows(ID.dono, "select recebido_centavos from finance_report($1, (now() - interval '2 days')::date, (now() + interval '5 days')::date)", [loja])
    expect(Number(meio[0].recebido_centavos)).toBe(Number(antes[0].recebido_centavos))

    for (const u of [ID.barb1, ID.cli1, ID.donoB]) await expect(val(u, "select confirm_payment($1)", [pag])).rejects.toThrow(/forbidden/)
    await expect(val(null, "select confirm_payment($1)", [pag])).rejects.toThrow(/permission denied/)
    await Promise.all(Array.from({ length: 4 }, () => rows(ID.dono, "select confirm_payment($1)", [pag])))
    expect(await rows(ID.dono, "select 1 from financial_ledger where ref_id = $1 and tipo = 'pagamento'", [pag])).toHaveLength(1)
    const depois = await rows(ID.dono, "select recebido_centavos from finance_report($1, (now() - interval '2 days')::date, (now() + interval '5 days')::date)", [loja])
    expect(Number(depois[0].recebido_centavos)).toBe(Number(antes[0].recebido_centavos) + 6000)
    await expect(val(ID.dono, "select discard_payment($1)", [pag])).rejects.toThrow(/payment_confirmed/)
    await rows(ID.dono, "select refund_payment($1, 6000, 'teste', 'k-est-confirmar')", [pag])
    await rows(ID.dono, "select cancel_booking($1)", [r])
  })

  it("pagamento declarado por engano pode ser descartado (e só pela gestão); ele trava o cancelamento até lá", async () => {
    const dia = await val(null, "select ((now() at time zone 'America/Sao_Paulo')::date + 4)::text")
    const slots = await rows(null, "select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, ana, dia])
    const r = await val(ID.cli1, "select create_booking($1, $2, $3, $4, 'Cliente', '11912345678', false, false, null)", [loja, corte, ana, slots[0].slot_inicio])
    const pag = await val(ID.dono, "select register_payment($1, 3000, 'dinheiro', 1, 'k-descartar')", [r])
    await expect(val(ID.dono, "select cancel_booking($1)", [r])).rejects.toThrow(/has_payments/)
    for (const u of [ID.barb1, ID.cli1, ID.donoB]) await expect(val(u, "select discard_payment($1)", [pag])).rejects.toThrow(/forbidden/)
    await rows(ID.dono, "select discard_payment($1)", [pag])
    expect(await rows(ID.dono, "select 1 from payments where id = $1", [pag])).toHaveLength(0)
    await rows(ID.dono, "select cancel_booking($1)", [r])
  })
})

describe("F07-01: repasses sem duplicidade e razão imutável (T14)", () => {
  it("estorno total antes do repasse cancela a comissão provisionada", async () => {
    expect(await val(ID.dono, "select status from commissions where booking_id = $1", [reservas[0]])).toBe("cancelada")
    await expect(val(ID.dono, "select create_payout($1, 'k-rep-ana')", [ana])).rejects.toThrow(/nothing_to_pay/)
  })

  it("o repasse liquida só comissões provisionadas e não se repete", async () => {
    await expect(val(ID.barb2, "select create_payout($1, 'k-rep')", [bia])).rejects.toThrow(/forbidden/)
    await expect(val(ID.donoB, "select create_payout($1, 'k-rep')", [bia])).rejects.toThrow(/forbidden/)
    const ids = await Promise.all(Array.from({ length: 6 }, () => val(ID.dono, "select create_payout($1, 'k-rep')", [bia])))
    expect(new Set(ids).size).toBe(1)
    expect(await val(ID.dono, "select valor_centavos from payouts where id = $1", [ids[0]])).toBe(2500)
    expect(await val(ID.dono, "select status from commissions where booking_id = $1", [reservas[1]])).toBe("liquidada")
    await expect(val(ID.dono, "select create_payout($1, 'k-rep-2')", [bia])).rejects.toThrow(/nothing_to_pay/)
  })

  it("estorno de atendimento cuja comissão já foi liquidada é recusado", async () => {
    const p = await val(ID.dono, "select id from payments where booking_id = $1 limit 1", [reservas[1]])
    await expect(val(ID.dono, "select refund_payment($1, 100, 'tarde demais', 'k-tarde')", [p])).rejects.toThrow(/commission_settled/)
  })

  it("o razão é somente de inserção e fecha com pagamentos e estornos", async () => {
    await expect(db.query("update financial_ledger set valor_centavos = 1")).rejects.toThrow(/immutable/)
    await expect(db.query("delete from financial_ledger")).rejects.toThrow(/immutable/)
    await expect(rows(ID.dono, "insert into financial_ledger (barbershop_id, tipo, valor_centavos) values ($1, 'pagamento', 1)", [loja])).rejects.toThrow(/permission denied/)
    const recebido = await val(ID.dono, "select coalesce(sum(valor_centavos),0)::int from financial_ledger where barbershop_id = $1 and tipo in ('pagamento','estorno')", [loja])
    const direto = await val(ID.dono, "select ((select coalesce(sum(valor_centavos),0) from payments where barbershop_id = $1) - (select coalesce(sum(valor_centavos),0) from refunds where barbershop_id = $1))::int", [loja])
    expect(Number(recebido)).toBe(Number(direto))
    const repasses = await val(ID.dono, "select coalesce(sum(valor_centavos),0)::int from financial_ledger where barbershop_id = $1 and tipo = 'repasse'", [loja])
    expect(Number(repasses)).toBe(-2500)
  })
})

describe("F07-04: custos e relatório", () => {
  it("só a gestão lança custos; valores inválidos são recusados", async () => {
    await expect(val(ID.barb1, "select add_expense($1, 'Aluguel', 'aluguel', 100000, current_date)", [loja])).rejects.toThrow(/forbidden/)
    await expect(val(ID.dono, "select add_expense($1, 'Aluguel', 'aluguel', 0, current_date)", [loja])).rejects.toThrow(/invalid_expense/)
    await rows(ID.dono, "select add_expense($1, 'Aluguel', 'aluguel', 100000, current_date)", [loja])
  })

  it("o relatório separa previsto, recebido, custos, comissões e resultado estimado", async () => {
    const [r] = await rows(ID.dono, "select * from finance_report($1, (now() - interval '2 days')::date, (now() + interval '2 days')::date)", [loja])
    expect(Number(r.recebido_centavos)).toBe(6000) // r1 estornado por inteiro, r2 pago por inteiro
    expect(Number(r.custos_centavos)).toBe(100000)
    expect(Number(r.comissoes_liquidadas_centavos) + Number(r.comissoes_provisionadas_centavos)).toBeGreaterThan(0)
    expect(Number(r.resultado_estimado_centavos)).toBe(Number(r.recebido_centavos) - Number(r.custos_centavos) - Number(r.comissoes_liquidadas_centavos) - Number(r.comissoes_provisionadas_centavos))
    await expect(rows(ID.barb1, "select * from finance_report($1, current_date, current_date)", [loja])).rejects.toThrow(/forbidden/)
    await expect(rows(ID.donoB, "select * from finance_report($1, current_date, current_date)", [loja])).rejects.toThrow(/forbidden/)
  })
})

describe("F07-06: RLS financeira (T02, T03)", () => {
  it("barbeiro vê só as próprias comissões; cliente e outra empresa não veem nada", async () => {
    expect((await rows(ID.barb1, "select booking_id from commissions")).map((r) => r.booking_id)).toEqual([reservas[0]])
    expect((await rows(ID.barb2, "select booking_id from commissions")).map((r) => r.booking_id)).toEqual([reservas[1]])
    for (const u of [ID.cli1, ID.donoB]) expect(await rows(u, "select 1 from commissions")).toHaveLength(0)
    expect(await rows(ID.dono, "select 1 from commissions")).toHaveLength(2)
  })

  it("barbeiro, cliente e outra empresa não leem pagamentos, estornos, custos nem o razão", async () => {
    for (const t of ["payments", "refunds", "expenses", "financial_ledger", "commission_rules"]) {
      for (const u of [ID.barb1, ID.cli1, ID.donoB]) expect(await rows(u, `select 1 from ${t}`)).toHaveLength(0)
      expect((await rows(ID.dono, `select 1 from ${t}`)).length).toBeGreaterThan(0)
    }
  })

  it("só o barbeiro dono do repasse o vê; ninguém escreve direto nas tabelas", async () => {
    expect(await rows(ID.barb2, "select 1 from payouts")).toHaveLength(1)
    expect(await rows(ID.barb1, "select 1 from payouts")).toHaveLength(0)
    for (const t of ["payments", "refunds", "commissions", "payouts", "expenses", "commission_rules"]) {
      await expect(rows(ID.dono, `delete from ${t}`)).rejects.toThrow(/permission denied/)
    }
  })

  it("T13: sem sessão, nenhuma função financeira executa", async () => {
    await expect(val(null, "select register_payment($1, 1, 'pix', 1, 'k')", [reservas[0]])).rejects.toThrow(/permission denied/)
    await expect(val(null, "select create_payout($1, 'k')", [ana])).rejects.toThrow(/permission denied/)
    await expect(rows(null, "select * from finance_report($1, current_date, current_date)", [loja])).rejects.toThrow(/permission denied/)
  })
})
