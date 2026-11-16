/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Escopo "confirmacoes_lembretes" do outbox-worker (o que o workflow n8n dispara a cada minuto), de ponta a ponta na fila local:
// migrations 0001–0020 em PGlite + processarConfirmacoesELembretes + cliente Evolution real com o servidor Evolution simulado.
// Nada aqui toca o banco remoto nem envia mensagem de verdade.
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { evoSendText } from "../functions/_shared/evolution-client"
import { DEFAULT_TEMPLATES, REMINDER_REPLY, withReminderReply } from "../functions/_shared/messages"
import { processarConfirmacoesELembretes, type Rpc } from "../functions/_shared/whatsapp-outbox"

// A página pública reserva por createBooking (src/features/booking/api.ts); aqui o supabase.rpc dela cai na fila local.
const app = vi.hoisted(() => ({ supabase: { rpc: vi.fn() } }))
vi.mock("@/lib/supabase", () => app)
import { createBooking } from "@/features/booking/api"

const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), donoB: U("a2"), cli1: U("d1"), cli2: U("d2") }
const EVOLUTION = { url: "https://evo.test", apiKey: "chave-teste", webhookSecret: "s", webhookBaseUrl: "https://projeto.supabase.co" }
const INSTANCIA = { A: "barberia_barbearia_a_000000000001", B: "barberia_barbearia_b_000000000002" }

// Mesmo ambiente do Supabase usado nos testes de diferença
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
type Loja = { id: string; corte: string; ana: string; dono: string; cliente: string }
const loja: Record<"A" | "B", Loja> = {} as any
let numero = 0

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

/** O mesmo contrato do supabase.rpc do worker, como service_role. */
const rpc: Rpc = async (fn, args = {}) => {
  const nomes = Object.keys(args)
  try {
    const linhas = await svc(`select * from ${fn}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(", ")})`, nomes.map((n) => args[n]))
    return { data: fn.startsWith("schedule_") ? Object.values(linhas[0])[0] : linhas, error: null }
  } catch (err) {
    return { data: null, error: { message: err instanceof Error ? err.message : String(err) } }
  }
}

/** Servidor Evolution simulado: guarda cada envio; `falhar` devolve HTTP 500. */
let envios: { instancia: string; numero: string; texto: string }[] = []
let falhar = false
function evolutionSimulada() {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const m = new URL(url).pathname.match(/^\/message\/sendText\/(.+)$/)
    if (!m || init.method !== "POST") return new Response("{}", { status: 404 })
    if (falhar) return new Response(JSON.stringify({ message: "instância caiu" }), { status: 500 })
    const corpo = JSON.parse(String(init.body))
    envios.push({ instancia: decodeURIComponent(m[1]), numero: corpo.number, texto: corpo.text })
    return new Response(JSON.stringify({ key: { id: `EVO-${envios.length}` } }), { status: 201 })
  })
}
const executarWorker = () =>
  processarConfirmacoesELembretes(rpc, async (instancia, numeroDestino, texto) => (await evoSendText(EVOLUTION, instancia, { number: numeroDestino, text: texto })).messageId)

async function montarLoja(chave: "A" | "B", dono: string, cliente: string): Promise<void> {
  const id = (await autenticado(dono, `select create_barbershop('Barbearia ${chave}', 'barbearia-${chave.toLowerCase()}') id`))[0].id
  const corte = (await autenticado(dono, "insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [id]))[0].id
  const ana = (await autenticado(dono, "select save_professional($1, null, 'Ana', true, $2) id", [id, [corte]]))[0].id
  const semana = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))
  await autenticado(dono, "select save_working_hours($1, $2)", [ana, semana])
  // canal conectado pelo botão "Conectar WhatsApp" (connect-instance/instance-status gravam isto)
  await sql("insert into integration_accounts (barbershop_id, provider, status, evolution_instance_name) values ($1, 'whatsapp', 'ativo', $2)", [id, INSTANCIA[chave]])
  loja[chave] = { id, corte, ana, dono, cliente }
}

/** Reserva com consentimento; `minutos` move o início para daqui a N minutos. */
async function reservar(chave: "A" | "B", minutos?: number): Promise<string> {
  const l = loja[chave]
  await sql("update bookings set status = 'cancelado' where customer_id = $1 and status in ('pendente', 'confirmado')", [l.cliente])
  await sql("delete from occupancies where professional_id = $1", [l.ana])
  const dia = (await sql("select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text d"))[0].d
  const [slot] = await sql("select slot_inicio from get_availability($1, $2, $3, $4) order by 1 limit 1", [l.id, l.corte, l.ana, dia])
  const [r] = await autenticado(l.cliente, "select create_booking($1, $2, $3, $4, 'Cliente Teste', $5, true, false, null) id",
    [l.id, l.corte, l.ana, slot.slot_inicio, `(67) 9${3000 + ++numero}-6649`])
  if (minutos !== undefined) {
    await sql("update bookings set inicio = now() + make_interval(mins => $2::int), fim = now() + make_interval(mins => $2::int + 40) where id = $1", [r.id, minutos])
  }
  return r.id
}
async function confirmar(chave: "A" | "B", reserva: string): Promise<void> {
  await sql("update bookings set status = 'pendente' where id = $1", [reserva])
  await autenticado(loja[chave].dono, "select set_booking_status($1, 'confirmado')", [reserva])
}
const fila = (reserva: string, tipo: string) =>
  sql("select id, status, tentativas, ultimo_erro, proximo_envio > now() as espera from outbox_events where booking_id = $1 and tipo like $2", [reserva, tipo])
const logs = (outbox: string) => sql("select status, provider_message_id, erro from notification_logs where outbox_id = $1", [outbox])

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } })
  await db.exec(AMBIENTE)
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql") && x.slice(0, 4) <= "0020").sort()) {
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  }
  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  await montarLoja("A", ID.dono, ID.cli1)
  await montarLoja("B", ID.donoB, ID.cli2)
}, 180_000)

afterAll(async () => {
  await db.close()
})

afterEach(() => {
  vi.unstubAllGlobals()
  envios = []
  falhar = false
})

describe("reserva pela página pública → workflow n8n entregue → Evolution simulada", () => {
  it("a reserva nasce confirmada, enfileira exatamente uma confirmação e o escopo do workflow a envia pela instância da barbearia", async () => {
    evolutionSimulada()
    const workflow = JSON.parse(readFileSync("n8n/barberia-fila-whatsapp.json", "utf8"))
    const http = workflow.nodes.find((n: any) => n.type === "n8n-nodes-base.httpRequest")
    expect(JSON.parse(http.parameters.jsonBody)).toEqual({ escopo: "confirmacoes_lembretes" }) // o que o worker recebe a cada minuto

    // o cliente logado confirma a reserva na página pública: a mesma chamada do app, como authenticated
    app.supabase.rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      const nomes = Object.keys(args)
      try {
        const [linha] = await autenticado(loja.A.cliente, `select ${fn}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(", ")}) v`, nomes.map((n) => args[n]))
        return { data: linha.v, error: null }
      } catch (err) {
        return { data: null, error: err }
      }
    })
    await sql("update bookings set status = 'cancelado' where customer_id = $1 and status in ('pendente', 'confirmado')", [loja.A.cliente])
    await sql("delete from occupancies where professional_id = $1", [loja.A.ana])
    const dia = (await sql("select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text d"))[0].d
    const [slot] = await sql("select slot_inicio from get_availability($1, $2, $3, $4) order by 1 limit 1", [loja.A.id, loja.A.corte, loja.A.ana, dia])
    const reserva = await createBooking({
      shopId: loja.A.id, serviceId: loja.A.corte, professionalId: loja.A.ana, inicio: slot.slot_inicio,
      // os mesmos dados que a página pública local enviou no create_booking (capturado no navegador)
      nome: "Cliente Teste Página", whatsapp: "67991112233", lembretes: true, marketing: false, key: "pagina-publica-1",
    })

    const confirmacoes = await fila(reserva, "reserva_confirmada")
    expect(confirmacoes).toHaveLength(1)
    expect(confirmacoes[0].status).toBe("pendente")

    const resultado = await executarWorker()
    expect(resultado).toMatchObject({ enviados: 1, falhas: 0 })
    expect(envios).toEqual([{ instancia: INSTANCIA.A, numero: "5567991112233", texto: expect.stringContaining("✅ Olá, Cliente! Seu agendamento está confirmado.") }])
    expect((await fila(reserva, "reserva_confirmada"))[0].status).toBe("enviado")
    // o aviso de "reserva registrada" não é do escopo do workflow: continua na fila, sem envio
    expect((await fila(reserva, "reserva_criada"))[0].status).toBe("pendente")
    await executarWorker()
    expect(envios).toHaveLength(1)
  })
})

describe("textos editáveis (0019): o worker envia o texto da barbearia", () => {
  const salvarTextos = (user: string, confirmacao: string, lembrete: string) =>
    autenticado(user, "select save_message_templates($1, $2, $3)", [loja.A.id, confirmacao, lembrete])

  it("cada barbearia começa com o texto padrão (igual ao do app)", async () => {
    const [b] = await sql("select msg_confirmacao, msg_lembrete from barbershops where id = $1", [loja.A.id])
    // o banco guarda o lembrete sem o pedido de SIM/NÃO; o worker e o editor acrescentam o bloco (withReminderReply)
    expect({ ...b, msg_lembrete: withReminderReply(b.msg_lembrete) }).toEqual({ msg_confirmacao: DEFAULT_TEMPLATES.confirmacao, msg_lembrete: DEFAULT_TEMPLATES.lembrete })
  })

  it("a diferença para o remoto troca o padrão antigo pelo formato com ícones e preserva texto personalizado", async () => {
    const ANTIGO = { c: "Olá, {nome}! Sua reserva em {barbearia} está confirmada.\n{servico} com {profissional}, {data} às {hora}.\nEndereço: {endereco}", l: "Olá, {nome}! Lembrete: seu horário em {barbearia} está chegando.\n{servico} com {profissional}, {data} às {hora}.\nEndereço: {endereco}" }
    await sql("update barbershops set msg_confirmacao = $2, msg_lembrete = $3 where id = $1", [loja.A.id, ANTIGO.c, ANTIGO.l])
    await sql("update barbershops set msg_confirmacao = 'Meu texto {nome}', msg_lembrete = $2 where id = $1", [loja.B.id, ANTIGO.l])
    await db.exec(readFileSync("supabase/aplicar/diferenca-textos-icones.sql", "utf8"))
    await db.exec(readFileSync("supabase/aplicar/diferenca-textos-icones.sql", "utf8")) // reaplicar não muda nada
    const textos = async (id: string) => {
      const [t] = await sql("select msg_confirmacao, msg_lembrete from barbershops where id = $1", [id])
      return { ...t, msg_lembrete: withReminderReply(t.msg_lembrete) }
    }
    expect(await textos(loja.A.id)).toEqual({ msg_confirmacao: DEFAULT_TEMPLATES.confirmacao, msg_lembrete: DEFAULT_TEMPLATES.lembrete })
    expect(await textos(loja.B.id)).toEqual({ msg_confirmacao: "Meu texto {nome}", msg_lembrete: DEFAULT_TEMPLATES.lembrete })
    await sql("update barbershops set msg_confirmacao = $2, msg_lembrete = $3 where id = $1", [loja.B.id, DEFAULT_TEMPLATES.confirmacao, DEFAULT_TEMPLATES.lembrete])
  })

  it("só a gestão salva, e texto vazio é recusado", async () => {
    await expect(salvarTextos(loja.A.cliente, "x", "y")).rejects.toThrow(/forbidden/)
    await expect(salvarTextos(ID.dono, "   ", "y")).rejects.toThrow(/invalid_template/)
  })

  it("confirmação e lembrete saem com o texto personalizado e as variáveis trocadas", async () => {
    await salvarTextos(ID.dono, "Oi {nome}! Confirmado: {servico} com {profissional}, {data} às {hora}.\nEndereço: {endereco}", "{nome}, faltam {antecedencia} para o seu {servico} na {barbearia}.")
    evolutionSimulada()
    await reservar("A", 20)
    await executarWorker()
    expect(envios).toHaveLength(2)
    const confirmacao = envios.find((e) => e.texto.startsWith("Oi Cliente!"))!
    expect(confirmacao.texto).toMatch(/^Oi Cliente! Confirmado: Corte com Ana, .+ às \d{2}:\d{2}\.$/) // sem endereço: a linha some
    expect(envios.find((e) => e.texto.startsWith("Cliente, faltam"))?.texto).toBe(`Cliente, faltam 30 minutos para o seu Corte na Barbearia A.\n\n${REMINDER_REPLY}`)
    await salvarTextos(ID.dono, DEFAULT_TEMPLATES.confirmacao, DEFAULT_TEMPLATES.lembrete)
  })
})

describe("retorno do cliente (0020): quem não voltou recebe a mensagem da barbearia", () => {
  const configurar = (ativo: boolean, quantidade: number, unidade: string, texto: string | null = null) =>
    autenticado(ID.dono, "select save_return_settings($1, $2, $3, $4, $5)", [loja.A.id, ativo, quantidade, unidade, texto])
  /** Atendimento concluído há `dias` dias, com ou sem consentimento de novidades. */
  async function concluidoHa(dias: number, novidades: boolean): Promise<string> {
    const r = await reservar("A")
    await sql("update bookings set status = 'concluido', inicio = now() - make_interval(days => $2::int), fim = now() - make_interval(days => $2::int) + interval '40 minutes' where id = $1", [r, dias])
    await sql("insert into customer_consents (barbershop_id, profile_id, marketing) values ($1, $2, $3) on conflict (barbershop_id, profile_id) do update set marketing = excluded.marketing", [loja.A.id, loja.A.cliente, novidades])
    return r
  }
  const retornos = (r: string) => sql("select id, tipo, status, ultimo_erro from outbox_events where booking_id = $1 and tipo like 'reativacao\\_%'", [r])

  afterEach(async () => {
    await configurar(false, 1, "meses")
    await sql("update outbox_events set status = 'cancelado' where tipo like 'reativacao%' and status in ('pendente', 'bloqueado')")
  })

  it("começa desligado; só a gestão configura e prazos fora do limite são recusados", async () => {
    expect((await sql("select retorno_ativo, retorno_quantidade, retorno_unidade, msg_retorno from barbershops where id = $1", [loja.A.id]))[0])
      .toEqual({ retorno_ativo: false, retorno_quantidade: 1, retorno_unidade: "meses", msg_retorno: DEFAULT_TEMPLATES.retorno })
    await expect(autenticado(loja.A.cliente, "select save_return_settings($1, true, 1, 'semanas', null)", [loja.A.id])).rejects.toThrow(/forbidden/)
    await expect(configurar(true, 25, "meses")).rejects.toThrow(/invalid_return/)
    await expect(configurar(true, 1, "anos")).rejects.toThrow(/invalid_return/)
  })

  it("1 semana: cliente que não voltou recebe o texto da barbearia, com {periodo}; a próxima execução não reenvia", async () => {
    await configurar(true, 1, "semanas", "Oi {nome}, já faz {periodo} do seu {servico}. Volta?")
    evolutionSimulada()
    const r = await concluidoHa(8, true)
    const resultado = await executarWorker()
    expect(resultado.agendados).toBeGreaterThanOrEqual(1)
    expect(envios.filter((e) => e.texto === "Oi Cliente, já faz 1 semana do seu Corte. Volta?")).toHaveLength(1)
    expect((await retornos(r))[0]).toMatchObject({ tipo: "reativacao_7", status: "enviado" })
    await executarWorker()
    expect(envios.filter((e) => e.texto.startsWith("Oi Cliente, já faz"))).toHaveLength(1)
  })

  it("desligar depois de enfileirar cancela o retorno antes do envio", async () => {
    await configurar(true, 1, "semanas")
    evolutionSimulada()
    const r = await concluidoHa(8, true)
    await svc("select schedule_reactivation()")
    expect((await retornos(r))[0]).toMatchObject({ status: "pendente" })
    await configurar(false, 1, "semanas")
    await executarWorker()
    expect((await retornos(r))[0]).toMatchObject({ status: "cancelado", ultimo_erro: "retorno_desativado" })
    expect(envios.filter((e) => e.texto.includes("Sentimos sua falta"))).toHaveLength(0)
  })

  it("sem consentimento de novidades, com horário já marcado, fora da janela ou desligado: nada sai", async () => {
    evolutionSimulada()
    await configurar(true, 1, "semanas")
    const semConsentimento = await concluidoHa(8, false)
    await executarWorker()
    expect(await retornos(semConsentimento)).toHaveLength(0)

    const longeDemais = await concluidoHa(30, true) // 1 semana + 7 dias de janela: 30 dias já passou
    await executarWorker()
    expect(await retornos(longeDemais)).toHaveLength(0)

    const comHorario = await concluidoHa(8, true)
    await sql("insert into bookings (barbershop_id, professional_id, customer_id, service_id, servico_nome, preco_centavos, duracao_min, inicio, fim, cliente_nome, cliente_whatsapp, status) select barbershop_id, professional_id, customer_id, service_id, servico_nome, preco_centavos, duracao_min, now() + interval '3 days', now() + interval '3 days 40 minutes', cliente_nome, cliente_whatsapp, 'confirmado' from bookings where id = $1", [comHorario])
    await executarWorker()
    expect(await retornos(comHorario)).toHaveLength(0)
    await sql("update bookings set status = 'cancelado' where customer_id = $1 and inicio > now()", [loja.A.cliente])

    await configurar(false, 1, "semanas")
    const desligado = await concluidoHa(8, true)
    await executarWorker()
    expect(await retornos(desligado)).toHaveLength(0)
    expect(envios.filter((e) => e.texto.includes("Sentimos sua falta"))).toHaveLength(0)
  })
})

describe("worker (escopo confirmacoes_lembretes) com envio simulado na fila local", () => {
  it("confirmação: a reserva nasce confirmada, enfileira uma, o worker envia pela instância da barbearia e registra na fila", async () => {
    evolutionSimulada()
    const r = await reservar("A")
    expect(await fila(r, "reserva_confirmada")).toHaveLength(1)
    const resultado = await executarWorker()

    expect(envios).toHaveLength(1)
    expect(envios[0]).toMatchObject({ instancia: INSTANCIA.A, numero: `55679${3000 + numero}6649` })
    expect(envios[0].texto).toContain("✅ Olá, Cliente! Seu agendamento está confirmado.")
    expect(envios[0].texto).toContain("📍 Local: Barbearia A")
    expect(resultado).toMatchObject({ recebidos: 1, enviados: 1, falhas: 0 })
    const [c] = await fila(r, "reserva_confirmada")
    expect(c.status).toBe("enviado")
    expect(await logs(c.id)).toEqual([{ status: "enviado", provider_message_id: "EVO-1", erro: null }])
    // só confirmações e lembretes: o aviso de reserva criada continua na fila, intacto, para o worker geral
    expect((await fila(r, "reserva_criada"))[0]).toMatchObject({ status: "pendente", tentativas: 0 })
  })

  it("lembrete: o worker agenda o lembrete da janela (30 min) e envia na mesma execução", async () => {
    evolutionSimulada()
    const r = await reservar("A", 20)
    const resultado = await executarWorker()

    expect(resultado.agendados).toBeGreaterThanOrEqual(1)
    // a mesma execução entrega a confirmação do nascimento e o lembrete, cada um uma vez
    expect(envios).toHaveLength(2)
    expect(envios.every((e) => e.instancia === INSTANCIA.A)).toBe(true)
    expect(envios.filter((e) => e.texto.includes("Seu agendamento está confirmado."))).toHaveLength(1)
    expect(envios.filter((e) => e.texto.startsWith("⏰ Olá, Cliente! Faltam 30 minutos para o seu atendimento!"))).toHaveLength(1)
    const [l] = await fila(r, "lembrete_%")
    expect(l.status).toBe("enviado")
    expect((await logs(l.id))[0]).toMatchObject({ status: "enviado", provider_message_id: expect.stringMatching(/^EVO-/) })
    // a próxima execução não envia de novo
    await executarWorker()
    expect(envios).toHaveLength(2)
  })

  it("cada barbearia usa a própria instância Evolution", async () => {
    evolutionSimulada()
    const a = await reservar("A")
    const b = await reservar("B")
    await confirmar("A", a) // aceitar de novo não gera uma segunda confirmação
    await confirmar("B", b)
    await executarWorker()
    expect(envios.map((e) => e.instancia).sort()).toEqual([INSTANCIA.A, INSTANCIA.B].sort())
  })

  it("auto_confirmation desligada: confirmar não enfileira nem envia nada", async () => {
    evolutionSimulada()
    await autenticado(ID.dono, "select save_site_profile($1, 'desc', 'azul', 'Rua Teste, 123', '(11) 91234-5678', $2::jsonb)",
      [loja.A.id, { auto_confirmation: false, auto_reminder: true, lead_time_minutes: 30 }])
    const r = await reservar("A")
    await confirmar("A", r)
    await executarWorker()
    expect(await fila(r, "reserva_confirmada")).toHaveLength(0) // nem ao nascer confirmada, nem ao aceitar
    expect(envios).toHaveLength(0)
    await autenticado(ID.dono, "select save_site_profile($1, 'desc', 'azul', 'Rua Teste, 123', '(11) 91234-5678', $2::jsonb)",
      [loja.A.id, { auto_confirmation: true, auto_reminder: true, lead_time_minutes: 30 }])
  })

  it("Evolution fora do ar: a falha fica registrada na fila e a mensagem volta para nova tentativa", async () => {
    evolutionSimulada()
    falhar = true
    const r = await reservar("A")
    await confirmar("A", r)
    const resultado = await executarWorker()
    expect(resultado).toMatchObject({ recebidos: 1, enviados: 0, falhas: 1 })
    const [c] = await fila(r, "reserva_confirmada")
    expect(c).toMatchObject({ status: "pendente", tentativas: 1, espera: true })
    expect(c.ultimo_erro).toContain("Evolution HTTP 500")
    expect((await logs(c.id))[0]).toMatchObject({ status: "falhou" })
  })
})
