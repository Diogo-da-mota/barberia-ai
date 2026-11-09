/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Agenda, disponibilidade e reservas (F03-03, F04, F05, F06) em PostgreSQL local (PGlite).
// Observação: o PGlite usa uma única conexão. A garantia contra reservas simultâneas vem da
// restrição de exclusão (testada aqui com tentativas em sequência); o teste com 10 conexões
// simultâneas (T05) precisa de um PostgreSQL com várias conexões.
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite({ extensions: { btree_gist } })
const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), donoB: U("b1"), barbeiro: U("c1"), cli1: U("d1"), cli2: U("d2"), cli3: U("d3"), cli4: U("d4"), cli5: U("d5"), cli6: U("d6"), cli7: U("d7") }
let lojaA = "", lojaB = "", corte = "", barba = "", ana = "", bia = "", amanha = ""

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
const rows = (user: string | null, sql: string, params: unknown[] = []) =>
  as(user, async () => (await db.query<Record<string, any>>(sql, params)).rows)
const val = async (user: string | null, sql: string, params: unknown[] = []) => Object.values((await rows(user, sql, params))[0])[0] as any

const slots = (prof: string | null, svc = corte, dia = amanha, user: string | null = null) =>
  rows(user, "select prof_id, prof_nome, slot_inicio from get_availability($1, $2, $3, $4) order by slot_inicio, prof_nome", [lojaA, svc, prof, dia])
const reservar = (user: string, inicio: string, prof: string | null = ana, svc = corte, key: string | null = null) =>
  val(user, "select create_booking($1, $2, $3, $4, 'Cliente Teste', '(11) 91234-5678', true, false, $5)", [lojaA, svc, prof, inicio, key])
const horaLocal = (ts: string) => new Date(ts).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `)
  for (const f of ["0001_identidade_inicial", "0002_catalogo", "0003_agenda"]) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${n}@example.test`])

  lojaA = await val(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")
  lojaB = await val(ID.donoB, "select create_barbershop('Barbearia B', 'barbearia-b')")
  await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'barbeiro')", [lojaA, ID.barbeiro])
  corte = (await rows(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [lojaA]))[0].id
  barba = (await rows(ID.dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Barba', 4000, 20) returning id", [lojaA]))[0].id
  ana = await val(ID.dono, "select save_professional($1, null, 'Ana', true, $2)", [lojaA, [corte, barba]])
  bia = await val(ID.dono, "select save_professional($1, null, 'Bia', true, $2)", [lojaA, [corte]])
  const semana = [0, 1, 2, 3, 4, 5, 6].flatMap((dow) => [{ dow, inicio_min: 540, fim_min: 720 }, { dow, inicio_min: 780, fim_min: 1080 }])
  for (const p of [ana, bia]) await rows(ID.dono, "select save_working_hours($1, $2)", [p, JSON.stringify(semana)])
  amanha = await val(null, "select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text")
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("F03-03: jornada", () => {
  it("só o gestor define a jornada, e intervalos não podem se sobrepor", async () => {
    await expect(rows(ID.barbeiro, "select save_working_hours($1, '[]')", [ana])).rejects.toThrow(/forbidden/)
    await expect(rows(ID.donoB, "select save_working_hours($1, '[]')", [ana])).rejects.toThrow(/forbidden/)
    await expect(rows(ID.dono, "select save_working_hours($1, $2)", [ana, JSON.stringify([{ dow: 1, inicio_min: 540, fim_min: 720 }, { dow: 1, inicio_min: 700, fim_min: 800 }])])).rejects.toThrow(/overlap/)
    await expect(rows(ID.dono, "select save_working_hours($1, $2)", [ana, JSON.stringify([{ dow: 1, inicio_min: 800, fim_min: 700 }])])).rejects.toThrow(/invalid_interval/)
    expect((await rows(ID.dono, "select 1 from working_hours where professional_id = $1", [ana])).length).toBe(14)
  })
})

describe("disponibilidade pública", () => {
  it("visitante lê a página pública e os horários, sem acesso às tabelas", async () => {
    const shop = await val(null, "select get_public_shop('Barbearia-A')")
    expect(shop.nome).toBe("Barbearia A")
    expect(shop.services.map((s: any) => s.nome)).toEqual(["Barba", "Corte"])
    expect(shop.professionals.map((p: any) => p.nome)).toEqual(["Ana", "Bia"])
    expect(await val(null, "select get_public_shop('inexistente')")).toBeNull()
    await expect(rows(null, "select 1 from bookings")).rejects.toThrow(/permission denied/)
    await expect(rows(null, "select 1 from working_hours")).rejects.toThrow(/permission denied/)
  })

  it("respeita pausa e duração: serviço de 40 min não começa depois das 11:20", async () => {
    const horas = (await slots(ana)).map((s) => horaLocal(s.slot_inicio))
    expect(horas).toContain("09:00")
    expect(horas).toContain("11:15")
    expect(horas).not.toContain("11:30")
    expect(horas).not.toContain("12:00")
    expect(horas).toContain("13:00")
    expect(horas).toContain("17:15")
    expect(horas).not.toContain("17:30")
  })

  it("não mostra dia passado, depois de 60 dias, serviço ou profissional inativo", async () => {
    expect(await slots(ana, corte, await val(null, "select ((now() at time zone 'America/Sao_Paulo')::date - 1)::text"))).toHaveLength(0)
    expect(await slots(ana, corte, await val(null, "select ((now() at time zone 'America/Sao_Paulo')::date + 61)::text"))).toHaveLength(0)
    expect(await slots(bia, barba)).toHaveLength(0)
  })
})

describe("reservas sem sobreposição", () => {
  let primeira = ""
  let hora9 = ""

  it("cria a reserva com snapshot e tira o horário da lista", async () => {
    hora9 = (await slots(ana)).find((s) => horaLocal(s.slot_inicio) === "09:00")!.slot_inicio
    primeira = await reservar(ID.cli1, hora9)
    const [b] = await rows(ID.cli1, "select status, servico_nome, preco_centavos, duracao_min, cliente_whatsapp from bookings where id = $1", [primeira])
    expect(b).toEqual({ status: "confirmado", servico_nome: "Corte", preco_centavos: 6000, duracao_min: 40, cliente_whatsapp: "11912345678" })
    expect((await slots(ana)).map((s) => horaLocal(s.slot_inicio))).not.toContain("09:00")
    expect(await rows(ID.cli1, "select papel from memberships where profile_id = $1", [ID.cli1])).toEqual([{ papel: "cliente" }])
  })

  it("T10: mudar o preço e a duração do serviço não altera a reserva antiga", async () => {
    await rows(ID.dono, "update services set preco_centavos = 9000, duracao_min = 60 where id = $1", [corte])
    expect(await rows(ID.cli1, "select preco_centavos, duracao_min from bookings where id = $1", [primeira])).toEqual([{ preco_centavos: 6000, duracao_min: 40 }])
    await rows(ID.dono, "update services set preco_centavos = 6000, duracao_min = 40 where id = $1", [corte])
  })

  it("rejeita a mesma hora para o mesmo profissional, e aceita outro profissional", async () => {
    await expect(reservar(ID.cli2, hora9)).rejects.toThrow(/slot_taken/)
    expect(await reservar(ID.cli2, hora9, bia)).toBeTruthy()
  })

  it("rejeita sobreposição parcial e aceita horário contíguo", async () => {
    const parcial = new Date(new Date(hora9).getTime() + 15 * 60_000).toISOString()
    await expect(reservar(ID.cli3, parcial)).rejects.toThrow(/slot_taken|invalid/)
    // Contíguo: a reserva começa exatamente quando o bloqueio termina
    const ini = (await slots(bia)).find((s) => horaLocal(s.slot_inicio) === "13:00")!.slot_inicio
    const meia = new Date(new Date(ini).getTime() + 30 * 60_000).toISOString()
    await val(ID.dono, "select create_block($1, $2, $3, $4, null)", [lojaA, bia, ini, meia])
    expect(await reservar(ID.cli3, meia, bia)).toBeTruthy()
  })

  it("rejeita horário fora da jornada, no passado e na pausa", async () => {
    const pausa = (await slots(ana)).find((s) => horaLocal(s.slot_inicio) === "13:00")!.slot_inicio
    const meioDia = new Date(new Date(pausa).getTime() - 60 * 60_000).toISOString()
    await expect(reservar(ID.cli3, meioDia)).rejects.toThrow(/slot_taken/)
    await expect(reservar(ID.cli3, new Date(Date.now() - 3600_000).toISOString())).rejects.toThrow(/slot_taken/)
  })

  it("qualquer profissional: escolhe quem estiver livre e falha quando todos ocupados", async () => {
    const h = (await slots(null)).find((s) => horaLocal(s.slot_inicio) === "10:00")!.slot_inicio
    const a = await reservar(ID.cli1, h, null)
    const b = await reservar(ID.cli2, h, null)
    const quem = await rows(ID.dono, "select professional_id from bookings where id = any($1)", [[a, b]])
    expect(new Set(quem.map((r) => r.professional_id))).toEqual(new Set([ana, bia]))
    await expect(reservar(ID.cli3, h, null)).rejects.toThrow(/slot_taken/)
  })

  it("T12: no máximo 3 reservas futuras ativas por cliente", async () => {
    let recusada = ""
    for (let i = 0; i < 4 && !recusada; i++) {
      const ultimo = (await slots(null, barba)).at(-1)!
      try { await reservar(ID.cli3, ultimo.slot_inicio, null, barba) } catch (e: any) { recusada = e.message }
    }
    expect(recusada).toMatch(/booking_limit/)
    const ativas = await val(ID.cli3, "select count(*)::int from bookings where status = 'confirmado' and inicio > now()")
    expect(ativas).toBe(3)
  })

  it("repetir a requisição com a mesma chave não duplica a reserva", async () => {
    const h = (await slots(ana)).find((s) => horaLocal(s.slot_inicio) === "14:00")!.slot_inicio
    const a = await reservar(ID.cli1, h, ana, corte, "chave-1")
    const b = await reservar(ID.cli1, h, ana, corte, "chave-1")
    expect(b).toBe(a)
    expect(await val(ID.dono, "select count(*)::int from bookings where idempotency_key = 'chave-1'")).toBe(1)
  })

  it("T08: bloqueio e reserva se impedem nos dois sentidos", async () => {
    const livre = (await slots(ana)).find((s) => horaLocal(s.slot_inicio) === "15:00")!.slot_inicio
    const fim = new Date(new Date(livre).getTime() + 60 * 60_000).toISOString()
    const bloqueio = await val(ID.dono, "select create_block($1, $2, $3, $4, 'Médico')", [lojaA, ana, livre, fim])
    await expect(reservar(ID.cli2, livre)).rejects.toThrow(/slot_taken/)
    await expect(val(ID.dono, "select create_block($1, $2, $3, $4, null)", [lojaA, ana, hora9, new Date(new Date(hora9).getTime() + 3600_000).toISOString()])).rejects.toThrow(/slot_taken/)
    await expect(val(ID.barbeiro, "select create_block($1, $2, $3, $4, null)", [lojaA, ana, livre, fim])).rejects.toThrow(/forbidden/)
    await rows(ID.dono, "select delete_block($1)", [bloqueio])
    expect(await reservar(ID.cli2, livre)).toBeTruthy()
  })
})

describe("cancelar, reagendar e status", () => {
  const novaReserva = async (user: string, hora: string, prof = ana) => {
    const h = (await slots(prof)).find((s) => horaLocal(s.slot_inicio) === hora)!.slot_inicio
    return { id: await reservar(user, h, prof), h }
  }

  it("o cliente cancela a própria reserva e o horário volta; outro cliente não pode", async () => {
    const { id, h } = await novaReserva(ID.cli4, "11:00")
    await expect(val(ID.cli2, "select cancel_booking($1)", [id])).rejects.toThrow(/forbidden/)
    await rows(ID.cli4, "select cancel_booking($1)", [id])
    expect(await val(ID.cli4, "select status from bookings where id = $1", [id])).toBe("cancelado")
    expect((await slots(ana)).map((s) => new Date(s.slot_inicio).toISOString())).toContain(new Date(h).toISOString())
    await expect(val(ID.cli4, "select cancel_booking($1)", [id])).rejects.toThrow(/invalid_status/)
  })

  it("dentro da janela de cancelamento só a gestão cancela", async () => {
    const { id } = await novaReserva(ID.cli5, "11:00")
    await db.query("update barbershops set cancel_window_min = 10080 where id = $1", [lojaA])
    await expect(val(ID.cli5, "select cancel_booking($1)", [id])).rejects.toThrow(/cancel_window/)
    await rows(ID.dono, "select cancel_booking($1)", [id])
    await db.query("update barbershops set cancel_window_min = 120 where id = $1", [lojaA])
  })

  it("T09: reagendar libera o horário antigo, e falha sem perder a reserva", async () => {
    const { id, h } = await novaReserva(ID.cli6, "11:00")
    const destino = (await slots(ana)).find((s) => horaLocal(s.slot_inicio) === "15:45")!.slot_inicio
    await rows(ID.cli6, "select reschedule_booking($1, $2, $3)", [id, destino, ana])
    expect((await rows(ID.cli6, "select inicio from bookings where id = $1", [id]))[0].inicio.toISOString()).toBe(new Date(destino).toISOString())
    expect((await slots(ana)).map((s) => new Date(s.slot_inicio).toISOString())).toContain(new Date(h).toISOString())
    expect(await val(ID.dono, "select count(*)::int from occupancies where periodo @> $1::timestamptz and professional_id = $2", [destino, ana])).toBe(1)

    const ocupado = (await rows(ID.dono, "select inicio from bookings where professional_id = $1 and status = 'confirmado' and id <> $2 limit 1", [ana, id]))[0].inicio
    await expect(val(ID.cli6, "select reschedule_booking($1, $2, $3)", [id, ocupado, ana])).rejects.toThrow(/slot_taken/)
    expect((await rows(ID.cli6, "select inicio, status from bookings where id = $1", [id]))[0].status).toBe("confirmado")
    expect(await val(ID.dono, "select count(*)::int from occupancies where periodo @> $1::timestamptz and professional_id = $2", [destino, ana])).toBe(1)
  })

  it("a gestão conclui só depois do horário; cliente e barbeiro não mudam o status", async () => {
    const { id } = await novaReserva(ID.cli7, "13:00")
    await expect(val(ID.dono, "select set_booking_status($1, 'concluido')", [id])).rejects.toThrow(/invalid_status/)
    await db.query("update bookings set inicio = now() - interval '2 hours', fim = now() - interval '80 minutes' where id = $1", [id])
    await expect(val(ID.cli7, "select set_booking_status($1, 'concluido')", [id])).rejects.toThrow(/forbidden/)
    await expect(val(ID.barbeiro, "select set_booking_status($1, 'concluido')", [id])).rejects.toThrow(/forbidden/)
    await rows(ID.dono, "select set_booking_status($1, 'nao_compareceu')", [id])
    expect(await val(ID.dono, "select status from bookings where id = $1", [id])).toBe("nao_compareceu")
    await expect(val(ID.dono, "select set_booking_status($1, 'concluido')", [id])).rejects.toThrow(/invalid_status/)
  })
})

describe("T03 e T01: isolamento e leitura", () => {
  it("cada cliente vê só as próprias reservas, e a gestão vê as da barbearia", async () => {
    const minhas = await rows(ID.cli1, "select customer_id from bookings")
    expect(minhas.length).toBeGreaterThan(0)
    expect(new Set(minhas.map((r) => r.customer_id))).toEqual(new Set([ID.cli1]))
    expect((await rows(ID.dono, "select 1 from bookings")).length).toBeGreaterThan(minhas.length)
  })

  it("barbeiro e outra empresa não leem reservas nem ocupações; cliente não lê bloqueios", async () => {
    for (const u of [ID.barbeiro, ID.donoB]) {
      expect(await rows(u, "select 1 from bookings")).toHaveLength(0)
      expect(await rows(u, "select 1 from occupancies")).toHaveLength(0)
    }
    expect(await rows(ID.cli1, "select 1 from occupancies")).toHaveLength(0)
    await expect(val(ID.donoB, "select cancel_booking($1)", [(await rows(ID.dono, "select id from bookings limit 1"))[0].id])).rejects.toThrow(/forbidden/)
    await expect(val(ID.donoB, "select create_block($1, $2, now() + interval '5 days', now() + interval '6 days', null)", [lojaB, ana])).rejects.toThrow(/forbidden/)
  })

  it("não há escrita direta nas tabelas da agenda", async () => {
    await expect(rows(ID.cli1, "update bookings set status = 'concluido'")).rejects.toThrow(/permission denied/)
    await expect(rows(ID.dono, "insert into occupancies (barbershop_id, professional_id, kind, periodo) values ($1, $2, 'block', tstzrange(now(), now() + interval '1 hour'))", [lojaA, ana])).rejects.toThrow(/permission denied/)
    await expect(rows(null, "select create_booking($1, $2, null, now(), 'x', '11999999999', false, false, null)", [lojaA, corte])).rejects.toThrow(/permission denied/)
  })

  it("registra o histórico de eventos da reserva", async () => {
    expect((await rows(ID.dono, "select distinct tipo from booking_events order by 1")).map((r) => r.tipo)).toEqual(["cancelled", "created", "rescheduled", "status"])
  })
})
