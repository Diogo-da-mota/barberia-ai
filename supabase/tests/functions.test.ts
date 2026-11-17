// @vitest-environment node
//
// Módulos puros das Edge Functions (F08-02, F08-04, F10-03): assinatura HMAC, leitura do webhook do WhatsApp,
// texto das mensagens e evento do Google Calendar. Nenhuma chamada de rede é feita.
import { describe, expect, it } from "vitest"
import { buildGoogleEvent } from "../functions/_shared/calendar"
import { DEFAULT_TEMPLATES, buildMessage, leadTimeLabel, messageVariables, renderTemplate, timeLeftLabel, toE164 } from "../functions/_shared/messages"
import { parseWhatsAppPayload, safeEqual, signHmacSha256, verifyHmacSha256 } from "../functions/_shared/webhook"
import { decryptSecret, encryptSecret } from "../functions/_shared/secret"

const SECRET = "segredo-do-app"
const body = JSON.stringify({ hello: "mundo" })

describe("assinatura do webhook (T16)", () => {
  it("aceita a assinatura correta (sha256=hex) e recusa as demais", async () => {
    const sig = await signHmacSha256(body, SECRET)
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(await verifyHmacSha256(body, sig, SECRET)).toBe(true)
    expect(await verifyHmacSha256(body + " ", sig, SECRET)).toBe(false) // corpo adulterado
    expect(await verifyHmacSha256(body, sig, "outro-segredo")).toBe(false)
    expect(await verifyHmacSha256(body, null, SECRET)).toBe(false)
    expect(await verifyHmacSha256(body, "", SECRET)).toBe(false)
    expect(await verifyHmacSha256(body, "sha256=zzzz", SECRET)).toBe(false)
    expect(await verifyHmacSha256(body, sig.replace("sha256=", "sha1="), SECRET)).toBe(false)
    expect(await verifyHmacSha256(body, sig, "")).toBe(false) // sem segredo configurado nada é aceito
  })
  it("compara em tempo constante e rejeita tamanhos diferentes", () => {
    expect(safeEqual("abc", "abc")).toBe(true)
    expect(safeEqual("abc", "abd")).toBe(false)
    expect(safeEqual("abc", "abcd")).toBe(false)
  })
})

describe("payload do WhatsApp Cloud API", () => {
  const payload = (messages: unknown[]) => ({ entry: [{ changes: [{ value: { messages } }] }] })
  it("extrai somente mensagens de texto ou botão com id, número, horário e mensagem citada", () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const out = parseWhatsAppPayload(payload([
      { id: "wamid.1", from: "5511912345678", timestamp: ts, type: "text", text: { body: "SIM" }, context: { id: "wamid.ORIG" } },
      { id: "wamid.2", from: "5511912345678", timestamp: ts, type: "button", button: { text: "Não" }, context: { id: "wamid.ORIG" } },
      { id: "wamid.3", from: "5511912345678", timestamp: ts, type: "image" },
      { from: "5511912345678", timestamp: ts, type: "text", text: { body: "x" } },
    ]))
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ eventId: "wamid.1", from: "5511912345678", text: "SIM", contextId: "wamid.ORIG" })
    expect(out[0].ts.getTime()).toBe(Number(ts) * 1000)
    expect(out[1]).toMatchObject({ eventId: "wamid.2", text: "Não" })
  })
  it("ignora payloads malformados sem lançar erro", () => {
    for (const bad of [null, undefined, {}, { entry: "x" }, { entry: [{ changes: null }] }, payload([null, 5, "x"])]) expect(parseWhatsAppPayload(bad)).toEqual([])
  })
})

describe("mensagens (F08-04)", () => {
  const base = { servico: "Corte", profissional: "Ana", inicio: "2026-11-07T17:30:00+00:00", fuso: "America/Sao_Paulo", barbearia: "Barbearia A", endereco: "Rua A, 10", cliente: "João" }
  it("a confirmação traz data, hora no fuso da barbearia, serviço, profissional e endereço", () => {
    const m = buildMessage("reserva_criada", base)
    expect(m).toContain("Barbearia A")
    expect(m).toContain("Corte")
    expect(m).toContain("Ana")
    expect(m).toContain("14:30") // 17:30 UTC = 14:30 em São Paulo
    expect(m).toContain("07/11")
    expect(m).toContain("Rua A, 10")
    expect(m).toMatch(/SIM/)
    expect(m).toMatch(/NÃO/)
  })
  it("omite o endereço quando não há e adapta os demais eventos", () => {
    expect(buildMessage("reserva_criada", { ...base, endereco: null })).not.toContain("null")
    expect(buildMessage("lembrete_24h", base)).toMatch(/amanhã|24/i)
    expect(buildMessage("lembrete_2h", base)).toMatch(/daqui a 2 horas|em 2 horas|2h/i)
    for (const tipo of ["lembrete_15min", "lembrete_30min", "lembrete_60min", "lembrete_120min"]) {
      const lembrete = buildMessage(tipo, base)
      expect(lembrete, tipo).toMatch(/lembrete/i)
      expect(lembrete, tipo).toContain("14:30")
    }
    expect(buildMessage("reserva_cancelada", base)).toMatch(/cancelad/i)
    expect(buildMessage("reserva_reagendada", base)).toBe(
      "✅ Olá, João! Seu agendamento foi reagendado.\n\n✂️ Serviço: Corte\n👤 Profissional: Ana\n📅 Data: 07/11\n🕔 Horário: 14:30\n📍 Local: Barbearia A\n\n📲 Se precisar, responda aqui no WhatsApp.",
    )
    expect(buildMessage("reativacao_30", base)).toMatch(/PARAR/)
    expect(buildMessage("calendar_upsert", base)).toBeNull() // não é mensagem ao cliente
  })
  it("normaliza números brasileiros para o formato internacional", () => {
    expect(toE164("11912345678")).toBe("5511912345678")
    expect(toE164("1132345678")).toBe("551132345678")
    expect(toE164("5511912345678")).toBe("5511912345678")
    expect(toE164("(11) 91234-5678")).toBe("5511912345678")
  })
})

describe("evento do Google Calendar (F10-03)", () => {
  it("monta o evento com fuso, horário e identificador da reserva para idempotência", () => {
    const e = buildGoogleEvent({ booking_id: "b-1", servico: "Corte", cliente: "João", profissional: "Ana", inicio: "2026-11-07T17:30:00+00:00", fim: "2026-11-07T18:10:00+00:00", fuso: "America/Sao_Paulo", barbearia: "Barbearia A", endereco: "Rua A, 10" })
    expect(e.summary).toBe("Corte — João")
    expect(e.start).toEqual({ dateTime: "2026-11-07T17:30:00.000Z", timeZone: "America/Sao_Paulo" })
    expect(e.end).toEqual({ dateTime: "2026-11-07T18:10:00.000Z", timeZone: "America/Sao_Paulo" })
    expect(e.location).toBe("Rua A, 10")
    expect(e.extendedProperties.private.barberiaBookingId).toBe("b-1")
    expect(JSON.stringify(e)).not.toContain("whatsapp") // sem telefone do cliente no calendário
  })
})

describe("textos editáveis da confirmação e do lembrete (renderTemplate)", () => {
  const vars = messageVariables({ cliente: "Maria Souza", servico: "Corte", profissional: "Marcelo Prado", inicio: "2026-11-09T11:30:00Z", fuso: "America/Sao_Paulo", barbearia: "Babearia do TICO", endereco: "Rua do Pombo", lead_time_minutes: 60 })

  it("troca as variáveis pelos dados da reserva", () => {
    expect(renderTemplate("Oi {nome}, {servico} com {profissional} às {hora} ({antecedencia} antes) em {barbearia}.", vars))
      .toBe("Oi Maria, Corte com Marcelo Prado às 08:30 (1 hora antes) em Babearia do TICO.")
    expect(vars.cliente).toBe("Maria Souza")
  })

  it("linha com variável vazia sai inteira; variável desconhecida fica visível", () => {
    const semEndereco = { ...vars, endereco: "" }
    expect(renderTemplate("Olá, {nome}!\nEndereço: {endereco}\nAté logo {apelido}", semEndereco)).toBe("Olá, Maria!\nAté logo {apelido}")
  })

  it("o texto padrão sai no formato com ícones (exemplo do proprietário)", () => {
    const p = { cliente: "Diogo Mota", servico: "Corte", profissional: "João", inicio: "2026-11-09T20:00:00Z", fuso: "America/Sao_Paulo", barbearia: "Barbearia do TICO", endereco: "Rua do Pombo", lead_time_minutes: 30 }
    expect(renderTemplate(DEFAULT_TEMPLATES.confirmacao, messageVariables(p))).toBe(
      "✅ Olá, Diogo! Seu agendamento está confirmado.\n\n✂️ Serviço: Corte\n👤 Profissional: João\n📅 Data: 09/11\n🕔 Horário: 17:00\n📍 Local: Barbearia do TICO")
    expect(renderTemplate(DEFAULT_TEMPLATES.lembrete, messageVariables(p))).toBe(
      "⏰ Olá, Diogo! Faltam 30 minutos para o seu atendimento!\n\n✂️ Serviço: Corte\n👤 Profissional: João\n📅 Data: 09/11\n🕔 Horário: 17:00\n📍 Local: Barbearia do TICO\n\n📲 Confirme sua presença:\n✅ Responda *SIM* para confirmar.\n❌ Responda *NÃO* se não puder comparecer.")
  })

  it("{falta} concorda com o número; {dia_semana} traz o dia por extenso", () => {
    expect([15, 30, 60, 120].map(timeLeftLabel)).toEqual(["Faltam 15 minutos", "Faltam 30 minutos", "Falta 1 hora", "Faltam 2 horas"])
    expect(messageVariables({ inicio: "2026-11-09T20:00:00Z", fuso: "America/Sao_Paulo" }).dia_semana).toBe("segunda-feira")
  })

  it("retorno do cliente: texto padrão com ícones e {periodo}", () => {
    const p = { cliente: "Maria Souza", servico: "Cabelo", profissional: "Marcelo Prado", inicio: "2026-10-08T15:00:00Z", fuso: "America/Sao_Paulo", barbearia: "Babearia do TICO", periodo: "1 mês" }
    expect(renderTemplate(DEFAULT_TEMPLATES.retorno, messageVariables(p))).toBe(
      "👋 Olá, Maria! Sentimos sua falta na Babearia do TICO.\n\n✂️ Último atendimento: Cabelo\n👤 Profissional: Marcelo Prado\n📅 Data: 08/10\n\nJá faz 1 mês. Que tal agendar o próximo horário?\n\nSe não quiser mais receber estas mensagens, é só responder avisando.")
  })

  it("antecedência legível", () => {
    expect([15, 30, 60, 120].map(leadTimeLabel)).toEqual(["15 minutos", "30 minutos", "1 hora", "2 horas"])
  })
})

describe("fotos no S3 (regras da Edge Function media)", async () => {
  const { KIND_FOLDER, MEDIA_FOLDER_RE, imageType, keyShop, newKey } = await import("../functions/_shared/image")
  const shop = "00000000-0000-4000-8000-0000000000a1"
  const bytes = (...head: number[]) => new Uint8Array([...head, ...new Array(16).fill(0)])
  const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))

  it("o tipo vem do conteúdo do arquivo (JPEG, PNG, WebP), não do nome nem do navegador", () => {
    expect(imageType(bytes(0xff, 0xd8, 0xff))).toEqual({ mime: "image/jpeg", ext: "jpg" })
    expect(imageType(bytes(0x89, ...ascii("PNG")))).toEqual({ mime: "image/png", ext: "png" })
    expect(imageType(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")))).toEqual({ mime: "image/webp", ext: "webp" })
    expect(imageType(bytes(...ascii("<svg")))).toBeNull()
    expect(imageType(bytes(...ascii("GIF8")))).toBeNull()
  })

  it("só as pastas da estrutura BARBEARIA/<barbearia>/...; nome único por envio", () => {
    for (const folder of [...Object.values(KIND_FOLDER), `servicos/${shop}`, `profissionais/${shop}`]) expect(MEDIA_FOLDER_RE.test(folder), folder).toBe(true)
    for (const folder of ["site", "site/outra", "../site/logo", "servicos/abc", "painel/inicio/x", "documentos"]) expect(MEDIA_FOLDER_RE.test(folder), folder).toBe(false)
    const a = newKey(shop, "site/logo", "jpg")
    expect(a).toMatch(new RegExp(`^BARBEARIA/${shop}/site/logo/[0-9a-f-]{36}\\.jpg$`))
    expect(newKey(shop, "site/logo", "jpg")).not.toBe(a)
  })

  it("apagar: só caminhos de foto de barbearia, e devolve a barbearia dona (para conferir o papel)", () => {
    expect(keyShop(`BARBEARIA/${shop}/site/galeria/x-1.webp`)).toBe(shop)
    for (const key of [`${shop}/logo-x.png`, `BARBEARIA/${shop}/site/logo/x.pdf`, `BARBEARIA/outra/site/logo/x.jpg`, `BARBEARIA/${shop}//x.jpg`, `BARBEARIA/${shop}/../x.jpg`]) expect(keyShop(key), key).toBeNull()
  })
})

describe("chave de IA cifrada por barbearia (Edge Function ai-credentials)", () => {
  const master = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
  const outraMestra = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)))
  const lojaA = "00000000-0000-4000-8000-0000000000a1"
  const lojaB = "00000000-0000-4000-8000-0000000000b1"
  const chave = "sk-proj-exemplo-de-chave-0000000000abcd"

  it("abre só na mesma barbearia e com a mesma chave mestra; o texto cifrado não contém a chave", async () => {
    const selada = await encryptSecret(chave, lojaA, master)
    expect(selada).not.toContain(chave)
    expect(selada).not.toBe(await encryptSecret(chave, lojaA, master)) // iv novo a cada gravação
    expect(await decryptSecret(selada, lojaA, master)).toBe(chave)
    await expect(decryptSecret(selada, lojaB, master)).rejects.toThrow() // copiada para outra barbearia não abre
    await expect(decryptSecret(selada, lojaA, outraMestra)).rejects.toThrow()
    await expect(decryptSecret(selada.slice(0, -4) + "AAAA", lojaA, master)).rejects.toThrow() // adulterada
  })

  it("sem chave mestra válida (32 bytes) nada é cifrado", async () => {
    await expect(encryptSecret(chave, lojaA, undefined)).rejects.toThrow(/AI_CREDENTIALS_KEY/)
    await expect(encryptSecret(chave, lojaA, btoa("curta"))).rejects.toThrow(/AI_CREDENTIALS_KEY/)
  })
})
