import { describe, expect, it } from "vitest"
import { formatTime } from "@/features/booking/domain"
import { DEFAULT_REMINDER_SETTINGS, channelLabel, eventLabel, inboundReasonLabel, maskPhone, normalizeReminderSettings, outboxReasonLabel, outboxStatusVariant, reminderSendAt, safeFormat, statusLabel } from "./domain"

describe("rótulos do painel de mensagens", () => {
  it("nomeia eventos e status", () => {
    expect(eventLabel("reserva_criada")).toBe("Confirmação da reserva")
    expect(eventLabel("lembrete_24h")).toBe("Lembrete de 24h")
    expect(eventLabel("lembrete_15min")).toBe("Lembrete de 15 min")
    expect(eventLabel("lembrete_30min")).toBe("Lembrete de 30 min")
    expect(eventLabel("lembrete_60min")).toBe("Lembrete de 1h")
    expect(eventLabel("lembrete_120min")).toBe("Lembrete de 2h")
    expect(eventLabel("reativacao_45")).toBe("Recuperação (45 dias)")
    expect(eventLabel("calendar_upsert")).toBe("Google Calendar: criar/atualizar")
    expect(eventLabel("novo_tipo")).toBe("novo_tipo")
    expect(statusLabel("bloqueado")).toBe("Bloqueado")
    expect(statusLabel("falhou")).toBe("Falhou")
  })
  it("explica por que um envio não saiu", () => {
    expect(outboxReasonLabel("canal_nao_configurado")).toMatch(/WhatsApp ainda não está configurado/)
    expect(outboxReasonLabel("sem_consentimento")).toMatch(/não autorizou/)
    expect(outboxReasonLabel("opt_out")).toMatch(/pediu para parar/)
    expect(outboxReasonLabel("timeout do provedor")).toBe("timeout do provedor")
    expect(outboxReasonLabel(null)).toBe("")
  })
  it("explica respostas ignoradas e canais", () => {
    expect(inboundReasonLabel("sem_correlacao")).toMatch(/não é resposta/)
    expect(inboundReasonLabel("replay")).toMatch(/antiga/)
    expect(channelLabel("whatsapp")).toBe("WhatsApp")
    expect(channelLabel("google_calendar")).toBe("Google Calendar")
  })
  it("varia a cor por status e mascara telefones", () => {
    expect(outboxStatusVariant("enviado")).toBe("income")
    expect(outboxStatusVariant("falhou")).toBe("danger")
    expect(outboxStatusVariant("bloqueado")).toBe("warning")
    expect(outboxStatusVariant("pendente")).toBe("info")
    expect(maskPhone("11912345678")).toBe("(11) 9****-5678")
    expect(maskPhone("5511912345678")).toBe("(11) 9****-5678")
    expect(maskPhone("abc")).toBe("—")
  })
})

describe("lembrete automático", () => {
  const tz = "America/Sao_Paulo"
  it("atendimento às 17h com 30 min de antecedência envia às 16h30", () => {
    const inicio = "2026-11-10T20:00:00.000Z" // 17:00 em São Paulo
    const envio = reminderSendAt(inicio, 30)
    expect(envio).toBe("2026-11-10T19:30:00.000Z")
    expect(safeFormat(envio, (iso) => formatTime(iso, tz))).toBe("16:30")
  })
  it("dados ausentes ou inválidos não lançam erro e devolvem null", () => {
    expect(reminderSendAt(undefined, 30)).toBeNull()
    expect(reminderSendAt("não é data", 30)).toBeNull()
    expect(reminderSendAt("2026-11-10T20:00:00.000Z", undefined)).toBeNull()
    expect(reminderSendAt("2026-11-10T20:00:00.000Z", Number.NaN)).toBeNull()
    expect(safeFormat("2026-11-10T20:00:00.000Z", (iso) => formatTime(iso, "Fuso/Inexistente"))).toBeNull()
    expect(safeFormat(null, (iso) => iso)).toBeNull()
  })
  it("normaliza o jsonb do banco (inclusive o perfil inteiro do site por engano)", () => {
    expect(normalizeReminderSettings(null)).toEqual(DEFAULT_REMINDER_SETTINGS)
    expect(normalizeReminderSettings({ descricao: "x", reminder_config: {} })).toEqual(DEFAULT_REMINDER_SETTINGS)
    expect(normalizeReminderSettings({ auto_confirmation: false, auto_reminder: true, lead_time_minutes: 60 }))
      .toEqual({ auto_confirmation: false, auto_reminder: true, lead_time_minutes: 60 })
    expect(normalizeReminderSettings({ lead_time_minutes: 45 }).lead_time_minutes).toBe(30)
  })
})
