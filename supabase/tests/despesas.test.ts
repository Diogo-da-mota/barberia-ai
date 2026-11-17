/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Despesas e contas a pagar (migration 0029) em PostgreSQL local (PGlite).
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite({ extensions: { btree_gist } })
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), gerente: U("a2"), donoB: U("b1"), barb: U("c1") }
const HOJE = "(now() at time zone 'America/Sao_Paulo')::date"
let loja = "", lojaB = ""

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
const admin = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows

/** create_expense com os 11 parâmetros; `venc`, `pagoEm` são expressões SQL de data (ou null). */
const criar = (user: string, id: string, o: { shop?: string; desc?: string; cat?: string; valor?: number; venc?: string; forma?: string | null; linha?: string | null; freq?: string | null; pagoEm?: string | null; pago?: number | null } = {}) =>
  val(user, `select create_expense($1, $2, $3, $4, $5, ${o.venc ?? `${HOJE} + 10`}, $6, $7, $8, ${o.pagoEm ?? "null"}, $9)`,
    [id, o.shop ?? loja, o.desc ?? "Energia elétrica", o.cat ?? "Energia", o.valor ?? 30000, o.forma ?? null, o.linha ?? null, o.freq ?? null, o.pago ?? null])
const relatorio = async () => (await rows(ID.dono, `select * from finance_report($1, ${HOJE} - 40, ${HOJE} + 40)`, [loja]))[0]
const razao = (ref: string) => admin("select valor_centavos::int as v from financial_ledger where ref_id = $1 and tipo = 'custo'", [ref])

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
  await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'gerente'), ($1, $3, 'barbeiro')", [loja, ID.gerente, ID.barb])
  // custo lançado ANTES da 0029 (dado legado), depois a migration nova
  await rows(ID.dono, `select add_expense($1, 'Aluguel antigo', 'Aluguel', 100000, ${HOJE} - 5)`, [loja])
  await db.exec(readFileSync("supabase/migrations/0029_despesas.sql", "utf8"))
  await db.exec(readFileSync("supabase/migrations/0030_despesas_mes.sql", "utf8"))
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("0029: dados anteriores", () => {
  it("o custo antigo vira 'legado': segue contando como custo na própria data, sem pagamento inventado e fora de A pagar", async () => {
    const [e] = await rows(ID.dono, "select situacao, pago_em, valor_pago_centavos from expenses where barbershop_id = $1", [loja])
    expect(e).toEqual({ situacao: "legado", pago_em: null, valor_pago_centavos: null })
    const r = await relatorio()
    expect(Number(r.custos_centavos)).toBe(100000)
    expect(Number(r.despesas_a_pagar_centavos)).toBe(0)
    await expect(rows(ID.dono, `select pay_expense((select id from expenses where barbershop_id = $1), ${HOJE}, 100000, 'pix')`, [loja])).rejects.toThrow(/expense_not_pending/)
  })
})

describe("0029: despesa avulsa", () => {
  it("pendente: aparece em A pagar, não entra em custos nem no razão; repetir a criação não duplica", async () => {
    await criar(ID.dono, U("e1"), { forma: "boleto", linha: " 34191.79001 01043.510047 91020.150008 5 90000000030000 " })
    await criar(ID.dono, U("e1"), { forma: "boleto" }) // nova tentativa com o mesmo id
    const lista = await rows(ID.dono, "select situacao, forma, linha_digitavel, valor_centavos from expenses where id = $1", [U("e1")])
    expect(lista).toEqual([{ situacao: "pendente", forma: "boleto", linha_digitavel: "34191.79001 01043.510047 91020.150008 5 90000000030000", valor_centavos: 30000 }])
    expect(await razao(U("e1"))).toHaveLength(0)
    const r = await relatorio()
    expect(Number(r.custos_centavos)).toBe(100000)
    expect(Number(r.despesas_a_pagar_centavos)).toBe(30000)
  })

  it("já paga: entra em custos e no razão uma única vez, mesmo repetindo a chamada", async () => {
    await criar(ID.gerente, U("e2"), { desc: "Produtos", cat: "Produtos", valor: 20000, venc: `${HOJE} - 1`, forma: "pix", pagoEm: `${HOJE} - 1` })
    await criar(ID.gerente, U("e2"), { desc: "Produtos", cat: "Produtos", valor: 20000, venc: `${HOJE} - 1`, forma: "pix", pagoEm: `${HOJE} - 1` })
    expect(await razao(U("e2"))).toEqual([{ v: -20000 }])
    expect(Number((await relatorio()).custos_centavos)).toBe(120000)
  })

  it("validação: valor, forma, pagamento no futuro, paga sem forma e recorrente já paga são recusados", async () => {
    await expect(criar(ID.dono, U("e9"), { valor: 0 })).rejects.toThrow(/invalid_expense/)
    await expect(criar(ID.dono, U("e9"), { desc: "  " })).rejects.toThrow(/invalid_expense/)
    await expect(criar(ID.dono, U("e9"), { forma: "cheque" })).rejects.toThrow(/invalid_expense/)
    await expect(criar(ID.dono, U("e9"), { forma: "pix", pagoEm: `${HOJE} + 1` })).rejects.toThrow(/invalid_expense/)
    await expect(criar(ID.dono, U("e9"), { pagoEm: HOJE })).rejects.toThrow(/invalid_expense/)
    await expect(criar(ID.dono, U("e9"), { freq: "mensal", forma: "pix", pagoEm: HOJE })).rejects.toThrow(/invalid_expense/)
    await expect(criar(ID.dono, U("e9"), { freq: "anual" })).rejects.toThrow(/invalid_expense/)
    expect(await admin("select 1 from expenses where id = $1", [U("e9")])).toHaveLength(0)
  })
})

describe("0029: pagar, alterar e excluir", () => {
  it("pagar registra data, valor efetivo e forma; o relatório usa o valor pago; pagar de novo é recusado e não soma duas vezes", async () => {
    await expect(rows(ID.dono, `select pay_expense($1, ${HOJE} + 1, 31550, 'boleto')`, [U("e1")])).rejects.toThrow(/invalid_expense_payment/)
    await expect(rows(ID.dono, `select pay_expense($1, ${HOJE}, 0, 'boleto')`, [U("e1")])).rejects.toThrow(/invalid_expense_payment/)
    expect((await rows(ID.dono, "select situacao from expenses where id = $1", [U("e1")]))[0].situacao).toBe("pendente") // erro mantém pendente
    await rows(ID.dono, `select pay_expense($1, ${HOJE}, 31550, 'boleto')`, [U("e1")]) // pago com juros
    await expect(rows(ID.dono, `select pay_expense($1, ${HOJE}, 31550, 'boleto')`, [U("e1")])).rejects.toThrow(/expense_not_pending/)
    const [e] = await rows(ID.dono, `select situacao, valor_centavos, valor_pago_centavos, forma, pago_em = ${HOJE} as hoje from expenses where id = $1`, [U("e1")])
    expect(e).toEqual({ situacao: "paga", valor_centavos: 30000, valor_pago_centavos: 31550, forma: "boleto", hoje: true })
    expect(await razao(U("e1"))).toEqual([{ v: -31550 }])
    const r = await relatorio()
    expect(Number(r.custos_centavos)).toBe(100000 + 20000 + 31550)
    expect(Number(r.despesas_a_pagar_centavos)).toBe(0)
    expect(Number(r.resultado_estimado_centavos)).toBe(Number(r.recebido_centavos) - Number(r.custos_centavos) - Number(r.comissoes_provisionadas_centavos) - Number(r.comissoes_liquidadas_centavos))
  })

  it("o custo conta no período do PAGAMENTO, não no do vencimento", async () => {
    await criar(ID.dono, U("e3"), { desc: "Internet", cat: "Internet", valor: 9990, venc: `${HOJE} - 60` })
    await rows(ID.dono, `select pay_expense($1, ${HOJE}, 9990, 'pix')`, [U("e3")])
    const [antigo] = await rows(ID.dono, `select custos_centavos from finance_report($1, ${HOJE} - 70, ${HOJE} - 50)`, [loja])
    expect(Number(antigo.custos_centavos)).toBe(0)
    expect(Number((await relatorio()).custos_centavos)).toBe(100000 + 20000 + 31550 + 9990)
  })

  it("alterar e excluir valem só para a pendente", async () => {
    await criar(ID.dono, U("e4"), { desc: "Água", cat: "Água", valor: 8000 })
    await rows(ID.dono, `select update_expense($1, 'Água e esgoto', 'Água', 8450, ${HOJE} + 3, 'pix', null)`, [U("e4")])
    expect((await rows(ID.dono, `select descricao, valor_centavos, data = ${HOJE} + 3 as venc from expenses where id = $1`, [U("e4")]))[0]).toEqual({ descricao: "Água e esgoto", valor_centavos: 8450, venc: true })
    await expect(rows(ID.dono, `select update_expense($1, 'x', 'x', 1, ${HOJE}, null, null)`, [U("e1")])).rejects.toThrow(/expense_not_pending/)
    await expect(rows(ID.dono, "select delete_expense($1)", [U("e1")])).rejects.toThrow(/expense_not_pending/)
    await rows(ID.dono, "select delete_expense($1)", [U("e4")])
    expect(await admin("select 1 from expenses where id = $1", [U("e4")])).toHaveLength(0)
  })
})

describe("0029: recorrência", () => {
  const ocorrencias = () => admin(`select (data - ${HOJE}) as d, valor_centavos as v, situacao as s from expenses where recurrence_id = $1 order by ocorrencia`, [U("f1")])

  it("mês sem o dia usa o último dia do mês, sempre a partir do início", async () => {
    const [d] = await admin("select private.expense_occurrence('2026-01-31', 'mensal', 1)::text as fev, private.expense_occurrence('2026-01-31', 'mensal', 2)::text as mar, private.expense_occurrence('2026-01-31', 'quinzenal', 1)::text as quinze, private.expense_occurrence('2026-01-31', 'semanal', 2)::text as sem")
    expect(d).toEqual({ fev: "2026-02-28", mar: "2026-03-31", quinze: "2026-02-15", sem: "2026-02-14" })
  })

  it("cria as contas até 35 dias à frente, todas pendentes; sincronizar ou repetir a criação não duplica", async () => {
    await criar(ID.dono, U("f1"), { desc: "Limpeza", cat: "Serviços", valor: 15000, venc: `${HOJE} - 14`, freq: "semanal" })
    await criar(ID.dono, U("f1"), { desc: "Limpeza", cat: "Serviços", valor: 15000, venc: `${HOJE} - 14`, freq: "semanal" })
    expect(await val(ID.dono, "select sync_expense_recurrences($1)", [loja])).toBe(0)
    const lista = await ocorrencias()
    expect(lista.map((o) => o.d)).toEqual([-14, -7, 0, 7, 14, 21, 28, 35])
    expect(lista.every((o) => o.s === "pendente" && o.v === 15000)).toBe(true)
    await expect(db.query("insert into expenses (barbershop_id, descricao, categoria, valor_centavos, data, situacao, recurrence_id, ocorrencia) select barbershop_id, 'x', 'x', 1, data, 'pendente', recurrence_id, ocorrencia from expenses where recurrence_id = $1 limit 1", [U("f1")])).rejects.toThrow(/uq_expenses_ocorrencia/)
  })

  it("o tempo passa: a próxima leitura cria só as contas novas", async () => {
    await db.query("update expense_recurrences set inicio = inicio - 7 where id = $1", [U("f1")]) // equivale a avançar 7 dias
    await db.query("update expenses set data = data - 7, ocorrencia = ocorrencia - 7 where recurrence_id = $1", [U("f1")])
    expect(await val(ID.gerente, "select sync_expense_recurrences($1)", [loja])).toBe(1)
    expect((await ocorrencias()).map((o) => o.d)).toEqual([-21, -14, -7, 0, 7, 14, 21, 28, 35])
  })

  it("o valor de uma ocorrência muda sem alterar as demais; a excluída não é recriada", async () => {
    const [alvo, fora] = await admin(`select id from expenses where recurrence_id = $1 and data in (${HOJE} + 7, ${HOJE} + 14) order by data`, [U("f1")])
    await rows(ID.dono, `select update_expense($1, 'Limpeza', 'Serviços', 18000, ${HOJE} + 7, null, null)`, [alvo.id])
    await rows(ID.dono, "select delete_expense($1)", [fora.id])
    expect(await val(ID.dono, "select sync_expense_recurrences($1)", [loja])).toBe(0)
    expect((await ocorrencias()).map((o) => [o.d, o.v])).toEqual([[-21, 15000], [-14, 15000], [-7, 15000], [0, 15000], [7, 18000], [21, 15000], [28, 15000], [35, 15000]])
    expect((await admin("select valor_centavos from expense_recurrences where id = $1", [U("f1")]))[0].valor_centavos).toBe(15000)
  })

  it("encerrar preserva pagas, vencidas e a de hoje; remove só as futuras e para de criar", async () => {
    const [paga] = await admin(`select id from expenses where recurrence_id = $1 and data = ${HOJE} - 21`, [U("f1")])
    await rows(ID.dono, `select pay_expense($1, ${HOJE}, 15000, 'dinheiro')`, [paga.id])
    await rows(ID.dono, "select end_expense_recurrence($1)", [U("f1")])
    await rows(ID.dono, "select end_expense_recurrence($1)", [U("f1")]) // repetir é seguro
    expect((await ocorrencias()).map((o) => [o.d, o.s])).toEqual([[-21, "paga"], [-14, "pendente"], [-7, "pendente"], [0, "pendente"]])
    expect(await val(ID.dono, "select sync_expense_recurrences($1)", [loja])).toBe(0)
    expect(await razao(paga.id)).toEqual([{ v: -15000 }])
  })
})

describe("0029: permissões e isolamento", () => {
  it("barbeiro e outra barbearia não gerenciam nem leem as despesas", async () => {
    await criar(ID.dono, U("e5"), { desc: "Aluguel", cat: "Aluguel", valor: 250000 })
    await criar(ID.dono, U("f2"), { desc: "Sistema", cat: "Assinaturas", valor: 9900, freq: "mensal" })
    for (const user of [ID.barb, ID.donoB]) {
      await expect(criar(user, U("e8"))).rejects.toThrow(/forbidden/)
      await expect(rows(user, `select pay_expense($1, ${HOJE}, 250000, 'pix')`, [U("e5")])).rejects.toThrow(/forbidden/)
      await expect(rows(user, `select update_expense($1, 'x', 'x', 1, ${HOJE}, null, null)`, [U("e5")])).rejects.toThrow(/forbidden/)
      await expect(rows(user, "select delete_expense($1)", [U("e5")])).rejects.toThrow(/forbidden/)
      await expect(rows(user, "select end_expense_recurrence($1)", [U("f2")])).rejects.toThrow(/forbidden/)
      await expect(rows(user, "select sync_expense_recurrences($1)", [loja])).rejects.toThrow(/forbidden/)
      expect(await rows(user, "select 1 from expenses where barbershop_id = $1", [loja])).toHaveLength(0)
      expect(await rows(user, "select 1 from expense_recurrences where barbershop_id = $1", [loja])).toHaveLength(0)
    }
    expect((await rows(ID.dono, "select situacao from expenses where id = $1", [U("e5")]))[0].situacao).toBe("pendente")
    expect((await rows(ID.gerente, "select 1 from expense_recurrences where barbershop_id = $1", [loja])).length).toBeGreaterThan(0)
  })

  it("a outra barbearia tem o próprio livro; escrita direta e visitante são bloqueados", async () => {
    await criar(ID.donoB, U("b5"), { shop: lojaB, valor: 5000 })
    const [r] = await rows(ID.donoB, `select * from finance_report($1, ${HOJE} - 40, ${HOJE} + 40)`, [lojaB])
    expect([Number(r.custos_centavos), Number(r.despesas_a_pagar_centavos)]).toEqual([0, 5000])
    await expect(rows(ID.dono, "update expenses set situacao = 'paga' where id = $1", [U("e5")])).rejects.toThrow(/permission denied/)
    await expect(rows(ID.dono, "insert into expense_recurrences (id, barbershop_id, descricao, categoria, valor_centavos, frequencia, inicio) values (gen_random_uuid(), $1, 'x', 'x', 1, 'mensal', current_date)", [loja])).rejects.toThrow(/permission denied/)
    await expect(rows(null, "select sync_expense_recurrences($1)", [loja])).rejects.toThrow(/permission denied/)
    await expect(rows(ID.dono, "select private.generate_expense_occurrences($1)", [U("f2")])).rejects.toThrow(/permission denied/)
  })
})

describe("0030: recorrência no mês consultado", () => {
  const resumo = async (id: string) => (await admin(`select count(*)::int as n, count(distinct ocorrencia)::int as distintas, (max(data) - ${HOJE}) as ultimo from expenses where recurrence_id = $1`, [id]))[0]

  it("cria as contas até o mês pedido, uma por ocorrência; repetir (ou usar a função antiga) não duplica", async () => {
    expect((await resumo(U("f2"))).n).toBe(1) // janela de 35 dias da 0029: só a primeira
    expect(await val(ID.gerente, `select sync_expense_recurrences($1, ${HOJE} + 200)`, [loja])).toBeGreaterThanOrEqual(5)
    expect(await val(ID.dono, `select sync_expense_recurrences($1, ${HOJE} + 200)`, [loja])).toBe(0)
    expect(await val(ID.dono, "select sync_expense_recurrences($1)", [loja])).toBe(0)
    expect(await val(ID.dono, `select sync_expense_recurrences($1, ${HOJE} - 90)`, [loja])).toBe(0) // mês passado não cria nada
    const r = await resumo(U("f2"))
    expect(r.n).toBe(r.distintas)
    expect(r.n).toBeGreaterThanOrEqual(6)
    expect(r.ultimo).toBeLessThanOrEqual(200)
    expect(r.ultimo).toBeGreaterThan(200 - 31)
    expect((await admin("select count(*)::int as n from expenses where recurrence_id = $1 and situacao <> 'pendente'", [U("f2")]))[0].n).toBe(0) // futuras nascem pendentes
  })

  it("conta já paga ou com valor ajustado não muda quando o mês seguinte é consultado", async () => {
    const [primeira, segunda] = await admin("select id from expenses where recurrence_id = $1 order by data limit 2", [U("f2")])
    await rows(ID.dono, `select pay_expense($1, ${HOJE}, 10500, 'credito')`, [primeira.id])
    await rows(ID.dono, `select update_expense($1, 'Sistema', 'Assinaturas', 12000, (select data from expenses where id = $1), null, null)`, [segunda.id])
    expect(await val(ID.dono, `select sync_expense_recurrences($1, ${HOJE} + 260)`, [loja])).toBeGreaterThanOrEqual(1)
    expect(await admin("select situacao, valor_centavos, valor_pago_centavos from expenses where id = any($1) order by data", [[primeira.id, segunda.id]])).toEqual([
      { situacao: "paga", valor_centavos: 9900, valor_pago_centavos: 10500 }, { situacao: "pendente", valor_centavos: 12000, valor_pago_centavos: null },
    ])
    expect(await razao(primeira.id)).toEqual([{ v: -10500 }])
  })

  it("limite de 24 meses: pedir um mês muito distante não gera histórico sem fim", async () => {
    await criar(ID.dono, U("f3"), { desc: "Lavanderia", cat: "Serviços", valor: 4000, venc: HOJE, freq: "semanal" })
    await rows(ID.dono, `select sync_expense_recurrences($1, ${HOJE} + 5000)`, [loja])
    const r = await resumo(U("f3"))
    expect(r.ultimo).toBeLessThanOrEqual(731)
    expect(r.ultimo).toBeGreaterThan(731 - 7)
    expect(r.n).toBe(r.distintas)
    expect(await val(ID.dono, `select sync_expense_recurrences($1, ${HOJE} + 5000)`, [loja])).toBe(0)
  })

  it("recorrência encerrada não cria contas; barbeiro, outra barbearia e visitante não sincronizam", async () => {
    await rows(ID.dono, "select end_expense_recurrence($1)", [U("f3")])
    await rows(ID.dono, "select end_expense_recurrence($1)", [U("f2")])
    expect(await val(ID.dono, `select sync_expense_recurrences($1, ${HOJE} + 700)`, [loja])).toBe(0)
    expect((await admin(`select count(*)::int as n from expenses where recurrence_id = any($1) and situacao = 'pendente' and data > ${HOJE}`, [[U("f2"), U("f3")]]))[0].n).toBe(0)
    for (const user of [ID.barb, ID.donoB]) await expect(rows(user, `select sync_expense_recurrences($1, ${HOJE} + 60)`, [loja])).rejects.toThrow(/forbidden/)
    await expect(rows(null, `select sync_expense_recurrences($1, ${HOJE} + 60)`, [loja])).rejects.toThrow(/permission denied/)
    await expect(rows(ID.dono, `select private.generate_expense_occurrences($1, ${HOJE} + 60)`, [U("f2")])).rejects.toThrow(/permission denied/)
  })
})

describe("0031: reversão, histórico, edição da paga e lote", () => {
  let hoje = ""
  const dia = (n: number) => new Date(Date.parse(`${hoje}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
  const livro = (ref: string) => admin("select tipo, valor_centavos::int as v from financial_ledger where ref_id = $1 order by criado_em, tipo", [ref])
  const eventos = (ref: string) => admin("select tipo, valor_centavos as v, forma, por from expense_events where expense_id = $1 order by criado_em, tipo", [ref])
  const lote = (user: string | null, itens: unknown[], shop = loja) => val(user, "select create_expenses($1, $2::jsonb)", [shop, JSON.stringify(itens)])
  const item = (id: string, o: Record<string, unknown> = {}) => ({ id, descricao: "Conta", categoria: "Geral", valor_centavos: 1000, vencimento: dia(3), forma: null, linha_digitavel: null, frequencia: null, pago_em: null, ...o })

  beforeAll(async () => {
    hoje = (await admin(`select (${HOJE})::text as d`))[0].d
    await db.exec(readFileSync("supabase/migrations/0031_despesas_reversao.sql", "utf8"))
  })

  it("pagamentos anteriores ganham uma linha de histórico cada, sem autor inventado; nada mais muda", async () => {
    const [n] = await admin("select (select count(*)::int from expenses where situacao = 'paga') as pagas, (select count(*)::int from expense_events where tipo = 'pagamento' and por is null) as eventos, (select count(*)::int from expense_events) as total")
    expect(n.pagas).toBeGreaterThan(0)
    expect([n.eventos, n.total]).toEqual([n.pagas, n.pagas])
    expect((await rows(ID.dono, "select situacao from expenses where descricao = 'Aluguel antigo'"))[0].situacao).toBe("legado")
  })

  it("reverter: conta de R$ 1.500 paga por engano volta a pendente; razão compensado, relatório corrigido, quem e quando registrados", async () => {
    await criar(ID.dono, U("a5"), { desc: "Fornecedor", cat: "Produtos", valor: 150000, venc: `${HOJE} + 5`, forma: "boleto" })
    const antes = await relatorio()
    await rows(ID.dono, `select pay_expense($1, ${HOJE}, 150000, 'pix')`, [U("a5")])
    expect(Number((await relatorio()).custos_centavos)).toBe(Number(antes.custos_centavos) + 150000)
    await rows(ID.gerente, "select revert_expense_payment($1)", [U("a5")])
    expect((await rows(ID.dono, "select situacao, pago_em, valor_pago_centavos, valor_centavos, forma from expenses where id = $1", [U("a5")]))[0])
      .toEqual({ situacao: "pendente", pago_em: null, valor_pago_centavos: null, valor_centavos: 150000, forma: "pix" })
    expect(await livro(U("a5"))).toEqual([{ tipo: "custo", v: -150000 }, { tipo: "custo_revertido", v: 150000 }])
    const depois = await relatorio()
    expect(Number(depois.custos_centavos)).toBe(Number(antes.custos_centavos))
    expect(Number(depois.despesas_a_pagar_centavos)).toBe(Number(antes.despesas_a_pagar_centavos))
    expect(Number(depois.resultado_estimado_centavos)).toBe(Number(antes.resultado_estimado_centavos))
    expect(await eventos(U("a5"))).toEqual([{ tipo: "pagamento", v: 150000, forma: "pix", por: ID.dono }, { tipo: "reversao", v: 150000, forma: "pix", por: ID.gerente }])
  })

  it("reversão duplicada, de conta pendente e de lançamento antigo são recusadas, sem novo lançamento", async () => {
    await expect(rows(ID.dono, "select revert_expense_payment($1)", [U("a5")])).rejects.toThrow(/expense_not_paid/)
    await expect(rows(ID.dono, "select revert_expense_payment((select id from expenses where descricao = 'Aluguel antigo'))")).rejects.toThrow(/expense_not_paid/)
    expect(await livro(U("a5"))).toHaveLength(2)
    expect(await eventos(U("a5"))).toHaveLength(2)
  })

  it("pagar de novo depois da reversão conta uma vez só, pelo novo valor", async () => {
    const antes = Number((await relatorio()).custos_centavos)
    await rows(ID.dono, `select pay_expense($1, ${HOJE}, 148000, 'transferencia')`, [U("a5")])
    expect(Number((await relatorio()).custos_centavos)).toBe(antes + 148000)
    expect((await admin("select sum(valor_centavos)::int as s from financial_ledger where ref_id = $1", [U("a5")]))[0].s).toBe(-148000)
    expect((await eventos(U("a5"))).map((e) => e.tipo)).toEqual(["pagamento", "reversao", "pagamento"])
  })

  it("reverter conta com vencimento passado: volta a pendente e, pela data, é vencida", async () => {
    await criar(ID.dono, U("a6"), { desc: "Contador", cat: "Serviços", valor: 40000, venc: `${HOJE} - 10` })
    await rows(ID.dono, `select pay_expense($1, ${HOJE} - 2, 40000, 'pix')`, [U("a6")])
    await rows(ID.dono, "select revert_expense_payment($1)", [U("a6")])
    expect((await rows(ID.dono, `select situacao, data < ${HOJE} as vencida from expenses where id = $1`, [U("a6")]))[0]).toEqual({ situacao: "pendente", vencida: true })
  })

  it("histórico é só de inserção e sobrevive à exclusão da conta", async () => {
    await expect(db.query("update expense_events set valor_centavos = 1")).rejects.toThrow(/immutable/)
    await expect(db.query("delete from expense_events")).rejects.toThrow(/immutable/)
    await expect(rows(ID.dono, "insert into expense_events (barbershop_id, expense_id, descricao, tipo, pago_em, valor_centavos) values ($1, $2, 'x', 'pagamento', current_date, 1)", [loja, U("a6")])).rejects.toThrow(/permission denied/)
    await rows(ID.dono, "select delete_expense($1)", [U("a6")])
    expect((await eventos(U("a6"))).map((e) => e.tipo)).toEqual(["pagamento", "reversao"])
    expect(await livro(U("a6"))).toHaveLength(2)
  })

  it("conta paga: descrição e categoria podem ser corrigidas; valor, vencimento e pagamento não mudam sem reverter", async () => {
    await rows(ID.gerente, "select update_expense_details($1, ' Fornecedor de produtos ', 'Estoque')", [U("a5")])
    expect((await rows(ID.dono, "select descricao, categoria, situacao, valor_pago_centavos from expenses where id = $1", [U("a5")]))[0])
      .toEqual({ descricao: "Fornecedor de produtos", categoria: "Estoque", situacao: "paga", valor_pago_centavos: 148000 })
    await expect(rows(ID.dono, "select update_expense_details($1, '', 'Estoque')", [U("a5")])).rejects.toThrow(/invalid_expense/)
    await expect(rows(ID.dono, `select update_expense($1, 'x', 'x', 1, ${HOJE}, null, null)`, [U("a5")])).rejects.toThrow(/expense_not_pending/)
    await rows(ID.dono, "select update_expense_details((select id from expenses where descricao = 'Aluguel antigo'), 'Aluguel de outubro', 'Aluguel')")
    expect((await admin("select situacao, valor_centavos from expenses where descricao = 'Aluguel de outubro'"))[0]).toEqual({ situacao: "legado", valor_centavos: 100000 })
  })

  it("lote: grava tudo em uma chamada; repetir o mesmo envio não duplica contas nem pagamentos", async () => {
    const itens = [
      item(U("c1"), { descricao: "Aluguel", categoria: "Aluguel", valor_centavos: 250000 }),
      item(U("c2"), { descricao: "Energia", categoria: "Energia", valor_centavos: 31000, forma: "boleto", linha_digitavel: "123 456" }),
      item(U("c3"), { descricao: "Café", categoria: "Copa", valor_centavos: 4500, vencimento: hoje, forma: "dinheiro", pago_em: hoje }),
      item(U("c4"), { descricao: "Sistema", categoria: "Assinaturas", valor_centavos: 9900, vencimento: hoje, frequencia: "mensal" }),
    ]
    expect(await lote(ID.dono, itens)).toBe(4)
    expect(await lote(ID.dono, itens)).toBe(4) // nova tentativa depois de resposta perdida
    expect((await admin("select count(*)::int as n from expenses where id = any($1)", [[U("c1"), U("c2"), U("c3")]]))[0].n).toBe(3)
    expect(await livro(U("c3"))).toEqual([{ tipo: "custo", v: -4500 }])
    expect(await eventos(U("c3"))).toHaveLength(1)
    const rec = await admin("select count(*)::int as n, count(distinct ocorrencia)::int as d from expenses where recurrence_id = $1", [U("c4")])
    expect(rec[0].n).toBe(rec[0].d)
    expect(rec[0].n).toBeGreaterThanOrEqual(1)
  })

  it("lote com linha inválida: aponta a linha e não grava nenhuma das outras", async () => {
    const bons = [item(U("d1")), item(U("d3"))]
    await expect(lote(ID.dono, [bons[0], item(U("d2"), { valor_centavos: 0 }), bons[1]])).rejects.toThrow(/invalid_expense_line:2/)
    await expect(lote(ID.dono, [bons[0], bons[1], item(U("d2"), { vencimento: "31/12/2026" })])).rejects.toThrow(/invalid_expense_line:3/)
    await expect(lote(ID.dono, [item(U("d2"), { pago_em: hoje })])).rejects.toThrow(/invalid_expense_line:1/) // paga sem forma
    expect(await admin("select 1 from expenses where id = any($1)", [[U("d1"), U("d2"), U("d3")]])).toHaveLength(0)
    await expect(lote(ID.dono, [])).rejects.toThrow(/invalid_expense_batch/)
    await expect(lote(ID.dono, Array.from({ length: 31 }, () => item(U("d1"))))).rejects.toThrow(/invalid_expense_batch/)
    expect(await lote(ID.dono, [bons[0], item(U("d2")), bons[1]])).toBe(3) // linha corrigida: agora grava as três
  })

  it("recorrência: pagar, reverter e renomear uma ocorrência não toca nas outras; encerrar preserva o histórico", async () => {
    await criar(ID.dono, U("c5"), { desc: "Lavagem de toalhas", cat: "Serviços", valor: 6000, venc: `${HOJE} - 7`, freq: "semanal" })
    const [primeira] = await admin("select id from expenses where recurrence_id = $1 order by data limit 1", [U("c5")])
    const outras = () => admin("select situacao, valor_centavos, descricao from expenses where recurrence_id = $1 and id <> $2 order by data", [U("c5"), primeira.id])
    const antes = await outras()
    await rows(ID.dono, `select pay_expense($1, ${HOJE}, 6500, 'pix')`, [primeira.id])
    await rows(ID.dono, "select revert_expense_payment($1)", [primeira.id])
    await rows(ID.dono, "select update_expense_details($1, 'Lavagem (semana do feriado)', 'Serviços')", [primeira.id])
    expect(await outras()).toEqual(antes)
    await rows(ID.dono, "select end_expense_recurrence($1)", [U("c5")])
    expect((await admin("select situacao from expenses where id = $1", [primeira.id]))[0].situacao).toBe("pendente") // vencida: fica
    expect((await eventos(primeira.id)).map((e) => e.tipo)).toEqual(["pagamento", "reversao"])
  })

  it("permissões e isolamento: barbeiro, outra barbearia e visitante não revertem, não editam, não gravam lote nem leem o histórico", async () => {
    for (const user of [ID.barb, ID.donoB]) {
      await expect(rows(user, "select revert_expense_payment($1)", [U("a5")])).rejects.toThrow(/forbidden/)
      await expect(rows(user, "select update_expense_details($1, 'x', 'x')", [U("a5")])).rejects.toThrow(/forbidden/)
      await expect(lote(user, [item(U("d9"))])).rejects.toThrow(/forbidden/)
      expect(await rows(user, "select 1 from expense_events where barbershop_id = $1", [loja])).toHaveLength(0)
    }
    await expect(rows(null, "select revert_expense_payment($1)", [U("a5")])).rejects.toThrow(/permission denied/)
    await expect(lote(null, [item(U("d9"))])).rejects.toThrow(/permission denied/)
    expect((await rows(ID.dono, "select situacao from expenses where id = $1", [U("a5")]))[0].situacao).toBe("paga")
    expect((await rows(ID.gerente, "select 1 from expense_events where barbershop_id = $1", [loja])).length).toBeGreaterThan(0)
    expect(await lote(ID.donoB, [item(U("d8"))], lojaB)).toBe(1)
    expect(await rows(ID.dono, "select 1 from expenses where id = $1", [U("d8")])).toHaveLength(0)
  })
})
