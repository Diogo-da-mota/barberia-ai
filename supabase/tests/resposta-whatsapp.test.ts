/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Confirmação pelo WhatsApp de ponta a ponta, sem nada real: todas as migrations em PGlite, o worker entrega pela Evolution
// simulada e a resposta do cliente chega como o MESSAGES_UPSERT da Evolution, pelo mesmo caminho do evolution-webhook
// (parseEvolutionMessage → process_whatsapp_reply com a barbearia da instância).
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { evoSendText } from "../functions/_shared/evolution-client"
import { REMINDER_REPLY, replyAck, rescheduleLink } from "../functions/_shared/messages"
import { parseEvolutionMessage } from "../functions/_shared/webhook"
import { processarConfirmacoesELembretes, type Rpc } from "../functions/_shared/whatsapp-outbox"
import { replyKind } from "@/features/messaging/domain"

const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { donoA: U("a1"), donoB: U("a2"), maria: U("d1") }
const EVOLUTION = { url: "https://evo.test", apiKey: "chave-teste", webhookSecret: "s", webhookBaseUrl: "https://projeto.supabase.co" }
const INSTANCIA = { A: "barberia_barbearia_a_000000000001", B: "barberia_barbearia_b_000000000002" }

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

let db: PGlite
const loja: Record<"A" | "B", { id: string; corte: string; ana: string }> = {} as any
let numero = 0
let mensagemId = 0

async function as<T>(role: "authenticated" | "service_role", user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""])
  await db.exec(`set role ${role}`)
  try {
    return await fn()
  } finally {
    await db.exec("reset role")
  }
}
const sql = async (q: string, p: unknown[] = []) => (await db.query<Record<string, any>>(q, p)).rows
const svc = (q: string, p: unknown[] = []) => as("service_role", null, () => sql(q, p))
const autenticado = (user: string, q: string, p: unknown[] = []) => as("authenticated", user, () => sql(q, p))

const rpc: Rpc = async (fn, args = {}) => {
  const nomes = Object.keys(args)
  try {
    const linhas = await svc(`select * from ${fn}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(", ")})`, nomes.map((n) => args[n]))
    return { data: fn.startsWith("schedule_") ? Object.values(linhas[0])[0] : linhas, error: null }
  } catch (err) {
    return { data: null, error: { message: err instanceof Error ? err.message : String(err) } }
  }
}

let envios: { numero: string; texto: string }[] = []
function evolutionSimulada() {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    if (!new URL(url).pathname.startsWith("/message/sendText/") || init.method !== "POST") return new Response("{}", { status: 404 })
    const corpo = JSON.parse(String(init.body))
    envios.push({ numero: corpo.number, texto: corpo.text })
    return new Response(JSON.stringify({ key: { id: `EVO-${crypto.randomUUID()}` } }), { status: 201 })
  })
}
const executarWorker = () =>
  processarConfirmacoesELembretes(rpc, async (instancia, destino, texto) => (await evoSendText(EVOLUTION, instancia, { number: destino, text: texto })).messageId)

/** Reserva da Maria em A com um WhatsApp só deste caso; `minutos` move o início para daqui a N minutos. */
async function reservar(whatsapp: string, opcoes: { minutos?: number; slot?: number; manter?: boolean } = {}): Promise<string> {
  const l = loja.A
  // snip:safe — cada caso reserva de novo com a mesma conta: tira as anteriores da janela do limite de 10 por 24 h (0021)
  await sql("update bookings set criado_em = now() - interval '25 hours' where customer_id = $1", [ID.maria])
  if (!opcoes.manter) {
    await sql("update bookings set status = 'cancelado' where customer_id = $1 and status in ('pendente', 'confirmado')", [ID.maria])
    await sql("delete from occupancies where professional_id = $1", [l.ana])
  }
  const dia = (await sql("select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text d"))[0].d
  const slots = await sql("select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [l.id, l.corte, l.ana, dia])
  const [r] = await autenticado(ID.maria, `select create_booking($1, $2, $3, $4, 'Maria', $5, true, false, null) id`, [l.id, l.corte, l.ana, slots[opcoes.slot ?? 0].slot_inicio, whatsapp])
  if (opcoes.minutos !== undefined) {
    await sql("update bookings set inicio = now() + make_interval(mins => $2::int), fim = now() + make_interval(mins => $2::int + 40) where id = $1", [r.id, opcoes.minutos])
  }
  return r.id
}
const enviadoPara = async (reserva: string, tipo = "reserva_confirmada") =>
  (await sql("select l.provider_message_id id from notification_logs l join outbox_events o on o.id = l.outbox_id where o.booking_id = $1 and o.tipo like $2 and l.status = 'enviado'", [reserva, tipo]))[0]?.id as string | undefined
const reserva = async (id: string) => (await sql("select status, occupancy_id from bookings where id = $1", [id]))[0]

/** MESSAGES_UPSERT da Evolution (v2). O número chega sem o 9 e, se `citada`, como resposta à mensagem enviada. */
function mensagem(whatsapp: string, texto: string, citada: string | null = null, key: Record<string, unknown> = {}) {
  const digitos = whatsapp.replace(/\D/g, "")
  return {
    key: { remoteJid: `55${digitos.slice(0, 2)}${digitos.slice(3)}@s.whatsapp.net`, fromMe: false, id: `3EB0${++mensagemId}`, ...key },
    pushName: "Maria",
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: citada ? { extendedTextMessage: { text: texto, contextInfo: { stanzaId: citada } } } : { conversation: texto },
  }
}
/** O mesmo que evolution-webhook faz no MESSAGES_UPSERT: barbearia pela instância, leitura e process_whatsapp_reply. */
async function receber(instancia: string, data: unknown): Promise<{ retorno: string | null; motivo?: string; status?: string }> {
  const [conta] = await sql("select barbershop_id from integration_accounts where provider = 'whatsapp' and evolution_instance_name = $1", [instancia])
  const m = parseEvolutionMessage(data)
  if (!m) return { retorno: null }
  const [r] = await svc(
    "select process_whatsapp_reply(p_event_id => $1, p_ts => $2::timestamptz, p_from => $3, p_context_message_id => $4, p_texto => $5, p_barbershop_id => $6) r",
    [m.eventId, m.ts.toISOString(), m.from, m.contextId, m.text, conta.barbershop_id],
  )
  const [inbound] = await sql("select status, motivo from inbound_webhook_events where event_id = $1", [m.eventId])
  return { retorno: r.r, ...inbound }
}
const fone = () => `(64) 9927${++numero}-0733`

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } })
  await db.exec(AMBIENTE)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  for (const [chave, dono] of [["A", ID.donoA], ["B", ID.donoB]] as const) {
    const id = (await autenticado(dono, `select create_barbershop('Barbearia ${chave}', 'barbearia-${chave.toLowerCase()}') id`))[0].id
    const corte = (await autenticado(dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [id]))[0].id
    const ana = (await autenticado(dono, "select save_professional($1, null, 'Ana', true, $2) id", [id, [corte]]))[0].id
    await autenticado(dono, "select save_working_hours($1, $2)", [ana, JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))])
    await sql("insert into integration_accounts (barbershop_id, provider, status, evolution_instance_name) values ($1, 'whatsapp', 'ativo', $2)", [id, INSTANCIA[chave]])
    loja[chave] = { id, corte, ana }
  }
}, 180_000)

afterAll(async () => {
  await db.close()
})

afterEach(() => {
  vi.unstubAllGlobals()
  envios = []
})

const reagendamento = async (id: string) =>
  (await sql("select detalhes ->> 'resposta' r from booking_events where booking_id = $1 and tipo = 'reagendamento' order by criado_em", [id])).map((x) => x.r)
const presenca = async (id: string) =>
  (await sql("select detalhes ->> 'resposta' r from booking_events where booking_id = $1 and tipo = 'presenca' order by criado_em", [id])).map((x) => x.r)

describe("lembrete → cliente responde SIM ou NÃO", () => {
  it("SIM sem citar registra a presença mesmo com a reserva já confirmada, agradece com o nome da barbearia e vale uma vez só", async () => {
    evolutionSimulada()
    const whatsapp = fone()
    const id = await reservar(whatsapp, { minutos: 20 })
    await executarWorker()
    expect(envios.map((e) => e.texto.endsWith(REMINDER_REPLY))).toEqual([false, true]) // confirmação sem a pergunta, lembrete com ela
    expect(envios[1].texto.match(/\*SIM\*/g)).toHaveLength(1) // o pedido de resposta aparece uma vez só
    expect((await reserva(id)).status).toBe("confirmado")

    const sim = mensagem(whatsapp, "Sim! 👍")
    const r = await receber(INSTANCIA.A, sim)
    expect(r).toEqual({ retorno: "processado", status: "processado", motivo: "sim" })
    expect(replyKind(r.motivo!, r.status!)).toBe("confirmou")
    expect(replyAck(r.motivo, "Barbearia A")).toBe("Obrigado por confirmar, Barbearia A agradece!")
    expect(await presenca(id)).toEqual(["sim"])
    expect((await reserva(id)).status).toBe("confirmado")
    // confirmar não gera uma segunda mensagem de confirmação
    expect(await sql("select count(*)::int n from outbox_events where booking_id = $1 and tipo = 'reserva_confirmada'", [id])).toEqual([{ n: 1 }])

    // a Evolution reenviou o mesmo evento, ou o cliente mandou SIM de novo: nada muda e nada é respondido
    expect((await receber(INSTANCIA.A, sim)).retorno).toBe("duplicado")
    const outro = await receber(INSTANCIA.A, mensagem(whatsapp, "SIM"))
    expect(outro).toMatchObject({ retorno: "ignorado", motivo: "ja_respondido" })
    expect(replyAck(outro.motivo, "Barbearia A")).toBeNull()
    // o SIM encerra a conversa deste lembrete: um NÃO depois não muda nada
    expect(await receber(INSTANCIA.A, mensagem(whatsapp, "NÃO"))).toMatchObject({ retorno: "ignorado", motivo: "ja_respondido" })
    expect(await presenca(id)).toEqual(["sim"])
    expect(await reagendamento(id)).toEqual([])
  })

  it("SIM de reserva pendente também a confirma", async () => {
    evolutionSimulada()
    const whatsapp = fone()
    const id = await reservar(whatsapp, { minutos: 20 })
    await executarWorker()
    await sql("update bookings set status = 'pendente' where id = $1", [id])
    expect((await receber(INSTANCIA.A, mensagem(whatsapp, "sim", (await enviadoPara(id, "lembrete%"))!))).retorno).toBe("processado")
    expect((await reserva(id)).status).toBe("confirmado")
    expect(await sql("select detalhes from booking_events where booking_id = $1 and tipo = 'status'", [id])).toEqual([{ detalhes: { de: "pendente", para: "confirmado", via: "whatsapp" } }])
  })

  it("NÃO não cancela e pergunta sobre reagendar; o 2º SIM pede o link, sem mexer na reserva; depois disso nada mais vale", async () => {
    evolutionSimulada()
    await sql("update barbershops set cancel_window_min = 0 where id = $1", [loja.A.id]) // nem dentro do prazo cancela
    const whatsapp = fone()
    const id = await reservar(whatsapp, { minutos: 20 })
    await executarWorker()
    const aviso = await enviadoPara(id, "lembrete%")
    expect(aviso).toMatch(/^EVO-/)
    const antes = await sql("select id, inicio, professional_id from bookings where right(cliente_whatsapp, 8) = right($1, 8)", [whatsapp.replace(/\D/g, "")])

    const r = await receber(INSTANCIA.A, mensagem(whatsapp, "Não.", aviso!))
    expect(r).toMatchObject({ retorno: "processado", status: "processado", motivo: "nao" })
    expect(replyKind(r.motivo!, r.status!)).toBe("nao_vai")
    expect(replyAck(r.motivo, "Barbearia A")).toBe("Obrigado por responder! Gostaria de reagendar? Responda SIM ou NÃO.")
    const depois = await reserva(id)
    expect(depois.status).toBe("confirmado")
    expect(depois.occupancy_id).not.toBeNull() // o horário continua ocupado
    expect(await presenca(id)).toEqual(["nao"])

    // 2º SIM, sem citar (ou citando a pergunta automática, que não é aviso nosso): quer reagendar
    const r2 = await receber(INSTANCIA.A, mensagem(whatsapp, "Sim", "EVO-pergunta-automatica"))
    expect(r2).toMatchObject({ retorno: "processado", status: "processado", motivo: "reagendar" })
    expect(replyKind(r2.motivo!, r2.status!)).toBe("nao_vai")
    const link = rescheduleLink("https://app.test/", "barbearia-a", id)
    expect(replyAck(r2.motivo, "Barbearia A", link)).toBe(`Perfeito! Escolha seu novo horário: https://app.test/barbearia-a/minhas-reservas?reagendar=${id}`)
    expect(replyAck(r2.motivo, "Barbearia A", null)).toBeNull() // sem APP_URL não manda link quebrado
    expect(await reagendamento(id)).toEqual(["sim"])
    // a reserva fica igual até o cliente concluir o reagendamento: nenhuma reserva nova, nada cancelado
    expect(await sql("select id, inicio, professional_id from bookings where right(cliente_whatsapp, 8) = right($1, 8)", [whatsapp.replace(/\D/g, "")])).toEqual(antes)
    expect((await reserva(id)).status).toBe("confirmado")

    expect(await receber(INSTANCIA.A, mensagem(whatsapp, "sim"))).toMatchObject({ retorno: "ignorado", motivo: "ja_respondido" })
    expect(await receber(INSTANCIA.A, mensagem(whatsapp, "não"))).toMatchObject({ retorno: "ignorado", motivo: "ja_respondido" })
    expect(await reagendamento(id)).toEqual(["sim"])

    await sql("update barbershops set cancel_window_min = 120 where id = $1", [loja.A.id])
    const destino = (await sql("select (((now() at time zone 'America/Sao_Paulo')::date + 1) + time '17:00') at time zone 'America/Sao_Paulo' as inicio"))[0].inicio
    const key = crypto.randomUUID()
    const move = () => autenticado(ID.maria, "select reschedule_booking($1, $2, $3, $4)", [id, destino, loja.A.ana, key])
    const totalEnvios = envios.length
    await move()
    await move()
    await executarWorker()
    await executarWorker()
    expect(envios.slice(totalEnvios).map((e) => e.texto)).toEqual([
      "✅ Maria, seu reagendamento foi confirmado para as 17:00!\n\n✂️ Corte — 40 minutos.\n\n⚠️ *Atenção:* chegue pontualmente. Em caso de atraso, seu atendimento poderá ser cancelado conforme as regras da barbearia.",
    ])
    expect(await sql("select inicio from bookings where id = $1", [id])).toEqual([{ inicio: destino }])
    expect(await sql("select status from outbox_events where booking_id = $1 and tipo = 'reserva_reagendada'", [id])).toEqual([{ status: "enviado" }])
    expect(await receber(INSTANCIA.A, mensagem(whatsapp, "SIM", (await enviadoPara(id, "reserva_reagendada"))!))).toMatchObject({ retorno: "ignorado", motivo: "sem_correlacao" })
  })

  it("NÃO e depois NÃO: desistência registrada para a equipe, sem cancelar; reenvio do mesmo evento é duplicado", async () => {
    evolutionSimulada()
    const whatsapp = fone()
    const id = await reservar(whatsapp, { minutos: 20 })
    await executarWorker()
    expect((await receber(INSTANCIA.A, mensagem(whatsapp, "NAO"))).motivo).toBe("nao")
    const segundo = mensagem(whatsapp, "Não")
    const r = await receber(INSTANCIA.A, segundo)
    expect(r).toMatchObject({ retorno: "processado", status: "processado", motivo: "nao_reagendar" })
    expect(replyAck(r.motivo, "Barbearia A")).toBe("Tudo bem! A barbearia será avisada.")
    expect(await reagendamento(id)).toEqual(["nao"])
    expect((await reserva(id)).status).toBe("confirmado")
    expect((await receber(INSTANCIA.A, segundo)).retorno).toBe("duplicado")
    expect(await receber(INSTANCIA.A, mensagem(whatsapp, "SIM"))).toMatchObject({ retorno: "ignorado", motivo: "ja_respondido" })
    expect(await presenca(id)).toEqual(["nao"])
  })

  it("não reenvia uma confirmação que ficou em envio depois de o worker perder a resposta", async () => {
    const id = await reservar(fone())
    const destino = (await sql("select inicio + interval '2 hours' as inicio from bookings where id = $1", [id]))[0].inicio
    await autenticado(ID.maria, "select reschedule_booking($1, $2, $3)", [id, destino, loja.A.ana])
    const [evento] = await sql("select id from outbox_events where booking_id = $1 and tipo = 'reserva_reagendada'", [id])
    expect(await svc("select id from claim_outbox(100) where id = $1", [evento.id])).toEqual([])
    expect(await svc("select id from claim_whatsapp_outbox(100) where id = $1", [evento.id])).toEqual([evento])

    await sql("update outbox_events set atualizado_em = now() - interval '11 minutes' where id = $1", [evento.id])
    evolutionSimulada()
    await executarWorker()
    expect(envios.some((e) => e.texto.includes("seu reagendamento foi confirmado"))).toBe(false)
    expect(await sql("select status, tentativas, ultimo_erro from outbox_events where id = $1", [evento.id]))
      .toEqual([{ status: "falhou", tentativas: 1, ultimo_erro: "envio_incerto" }])
  })

  it("a etapa é da conversa de cada número: o NÃO de um cliente não transforma o SIM de outro em reagendamento", async () => {
    evolutionSimulada()
    const fone1 = fone()
    const fone2 = fone()
    const r1 = await reservar(fone1, { minutos: 20 })
    const r2 = await reservar(fone2, { minutos: 30, slot: 2, manter: true })
    await executarWorker()
    expect((await receber(INSTANCIA.A, mensagem(fone1, "não"))).motivo).toBe("nao")
    expect((await receber(INSTANCIA.A, mensagem(fone2, "sim"))).motivo).toBe("sim") // 1ª resposta do outro: presença
    expect([await presenca(r1), await presenca(r2)]).toEqual([["nao"], ["sim"]])
    expect([await reagendamento(r1), await reagendamento(r2)]).toEqual([[], []])
  })

  it("a confirmação da reserva não pede resposta: SIM a ela não é correlacionado", async () => {
    evolutionSimulada()
    const whatsapp = fone()
    const id = await reservar(whatsapp) // amanhã: só a confirmação sai
    await executarWorker()
    expect(envios).toHaveLength(1)
    expect(envios[0].texto).not.toMatch(/SIM/)
    expect(await receber(INSTANCIA.A, mensagem(whatsapp, "SIM", (await enviadoPara(id))!))).toMatchObject({ retorno: "ignorado", motivo: "sem_correlacao" })
    expect(await receber(INSTANCIA.A, mensagem(whatsapp, "SIM"))).toMatchObject({ retorno: "ignorado", motivo: "sem_correlacao" })
    expect(await presenca(id)).toEqual([])
  })
})

describe("não atualiza a reserva errada", () => {
  it("duas reservas futuras do mesmo número e SIM sem citar: não adivinha", async () => {
    evolutionSimulada()
    const whatsapp = fone()
    const r1 = await reservar(whatsapp, { minutos: 20 })
    const r2 = await reservar(whatsapp, { slot: 2, manter: true, minutos: 30 })
    await executarWorker()
    await sql("update bookings set status = 'pendente' where id = any($1)", [[r1, r2]])

    expect(await receber(INSTANCIA.A, mensagem(whatsapp, "sim"))).toMatchObject({ retorno: "ignorado", motivo: "ambiguo" })
    expect([(await reserva(r1)).status, (await reserva(r2)).status]).toEqual(["pendente", "pendente"])
    // citando o lembrete da segunda, só ela é confirmada
    expect((await receber(INSTANCIA.A, mensagem(whatsapp, "sim", (await enviadoPara(r2, "lembrete%"))!))).retorno).toBe("processado")
    expect([(await reserva(r1)).status, (await reserva(r2)).status]).toEqual(["pendente", "confirmado"])
  })

  it("resposta chegando na instância de outra barbearia não mexe na reserva desta", async () => {
    evolutionSimulada()
    const whatsapp = fone()
    const id = await reservar(whatsapp, { minutos: 20 })
    await executarWorker()
    await sql("update bookings set status = 'pendente' where id = $1", [id])

    expect(await receber(INSTANCIA.B, mensagem(whatsapp, "SIM", (await enviadoPara(id, "lembrete%"))!))).toMatchObject({ retorno: "ignorado", motivo: "sem_correlacao" })
    expect(await receber(INSTANCIA.B, mensagem(whatsapp, "SIM"))).toMatchObject({ retorno: "ignorado", motivo: "sem_correlacao" })
    expect((await reserva(id)).status).toBe("pendente")
    expect(await presenca(id)).toEqual([])
  })

  it("sem citar, uma resposta mais de 12 h depois do último lembrete não vale", async () => {
    evolutionSimulada()
    const whatsapp = fone()
    const id = await reservar(whatsapp, { minutos: 20 })
    await executarWorker()
    await sql("update notification_logs set criado_em = now() - interval '13 hours' where outbox_id in (select id from outbox_events where booking_id = $1)", [id])

    expect(await receber(INSTANCIA.A, mensagem(whatsapp, "não"))).toMatchObject({ retorno: "ignorado", motivo: "sem_correlacao" })
    expect(await presenca(id)).toEqual([])
  })

  it("mensagens nossas, de grupo, de status e mídia não são respostas", () => {
    const base = mensagem("(64) 99275-0733", "SIM")
    expect(parseEvolutionMessage({ ...base, key: { ...base.key, fromMe: true } })).toBeNull()
    expect(parseEvolutionMessage({ ...base, key: { ...base.key, remoteJid: "120363@g.us", participant: "556492750733@s.whatsapp.net" } })).toBeNull()
    expect(parseEvolutionMessage({ ...base, key: { ...base.key, remoteJid: "status@broadcast" } })).toBeNull()
    expect(parseEvolutionMessage({ ...base, message: { imageMessage: { caption: "SIM" } } })).toBeNull()
    // conversa com endereço @lid: o número vem em senderPn
    expect(parseEvolutionMessage({ ...base, key: { ...base.key, remoteJid: "123456789@lid", senderPn: "556492750733@s.whatsapp.net" } })).toMatchObject({ from: "556492750733", text: "SIM", contextId: null })
  })
})
