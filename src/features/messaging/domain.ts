export type OutboxStatus = "pendente" | "enviando" | "enviado" | "falhou" | "bloqueado" | "cancelado"

const EVENTS: Record<string, string> = {
  reserva_criada: "Confirmação da reserva",
  reserva_confirmada: "Reserva confirmada",
  reserva_cancelada: "Cancelamento",
  reserva_reagendada: "Reagendamento",
  atendimento_concluido: "Atendimento concluído",
  lembrete_24h: "Lembrete de 24h",
  lembrete_2h: "Lembrete de 2h",
  calendar_upsert: "Google Calendar: criar/atualizar",
  calendar_delete: "Google Calendar: remover",
}

export function eventLabel(tipo: string): string {
  const reativacao = /^reativacao_(\d+)$/.exec(tipo)
  if (reativacao) return `Recuperação (${reativacao[1]} dias)`
  const lembrete = /^lembrete_(\d+)min$/.exec(tipo)
  if (lembrete) {
    const minutos = Number(lembrete[1])
    return minutos % 60 === 0 ? `Lembrete de ${minutos / 60}h` : `Lembrete de ${minutos} min`
  }
  return EVENTS[tipo] ?? tipo
}

export const statusLabel = (status: string) =>
  ({ pendente: "Na fila", enviando: "Enviando", enviado: "Enviado", falhou: "Falhou", bloqueado: "Bloqueado", cancelado: "Cancelado" } as Record<string, string>)[status] ?? status

export function outboxStatusVariant(status: string): "income" | "danger" | "warning" | "info" | "default" {
  return ({ enviado: "income", falhou: "danger", bloqueado: "warning", pendente: "info", enviando: "info" } as Record<string, "income" | "danger" | "warning" | "info">)[status] ?? "default"
}

const OUTBOX_REASONS: Record<string, string> = {
  canal_nao_configurado: "O WhatsApp ainda não está configurado para esta barbearia. Nada foi enviado.",
  sem_consentimento: "O cliente não autorizou avisos sobre a reserva.",
  limite_telefone: "Este número já recebeu muitos avisos de reserva nas últimas 24 horas. A reserva continua valendo.",
  opt_out: "O cliente pediu para parar de receber novidades.",
  reserva_cancelada: "A reserva foi cancelada antes do envio.",
  reserva_vencida: "O atendimento começou antes do envio do lembrete.",
  reserva_reagendada: "A reserva foi reagendada antes do envio deste aviso.",
  envio_incerto: "O envio da confirmação não pôde ser verificado. Confira a conversa no WhatsApp.",
  vinculo_removido: "O vínculo com o calendário foi removido.",
}
export const outboxReasonLabel = (reason: string | null): string => (reason ? OUTBOX_REASONS[reason] ?? reason : "")

const INBOUND_REASONS: Record<string, string> = {
  sem_correlacao: "A mensagem não é resposta a um aviso enviado por nós.",
  ambiguo: "O cliente tem mais de uma reserva futura: precisa responder citando o aviso.",
  telefone_divergente: "O número não é o da reserva.",
  desatualizado: "A reserva mudou depois do aviso respondido.",
  estado_final: "A reserva já estava concluída ou cancelada.",
  ja_confirmado: "A reserva já estava confirmada.",
  fora_da_janela: "Cancelamento fora do prazo permitido.",
  ja_respondido: "O cliente já tinha respondido a este aviso.",
  reagendar: "Cliente quer reagendar: recebeu o link para escolher o novo horário. A reserva continua até ele concluir.",
  nao_reagendar: "Cliente não pode ir e não quer reagendar. A reserva continua: fale com ele ou cancele.",
  resposta_invalida: "Resposta diferente de SIM ou NÃO.",
  replay: "Mensagem antiga ou com horário inválido.",
  telefone_invalido: "Número inválido.",
  opt_out: "Cliente pediu para parar de receber novidades.",
  sim: "Cliente confirmou a presença.",
  nao: "Cliente avisou que não pode ir. A reserva continua: reagende ou cancele.",
}
export const inboundReasonLabel = (reason: string | null): string => (reason ? INBOUND_REASONS[reason] ?? reason : "")

export const channelLabel = (canal: string) => (canal === "google_calendar" ? "Google Calendar" : canal === "whatsapp" ? "WhatsApp" : canal)

/** Telefone só com DDD e os 4 últimos dígitos, para o painel não expor o número inteiro. */
export function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "")
  if (digits.length < 10) return "—"
  const national = digits.length > 11 ? digits.slice(-11) : digits
  const ddd = national.slice(0, 2)
  const rest = national.slice(2)
  return `(${ddd}) ${rest.length === 9 ? "9" : ""}****-${rest.slice(-4)}`
}

/** Estados reais do envio, agrupados para os filtros da Central. "Enviada" só existe quando o provedor confirmou. */
export type StatusFilter = "todas" | "fila" | "enviadas" | "falhas" | "bloqueadas" | "canceladas"
export const STATUS_FILTERS: { id: StatusFilter; label: string; statuses: string[] }[] = [
  { id: "todas", label: "Todas", statuses: [] },
  { id: "fila", label: "Na fila", statuses: ["pendente", "enviando"] },
  { id: "enviadas", label: "Enviadas", statuses: ["enviado"] },
  { id: "falhas", label: "Falhas", statuses: ["falhou"] },
  { id: "bloqueadas", label: "Bloqueadas", statuses: ["bloqueado"] },
  { id: "canceladas", label: "Canceladas", statuses: ["cancelado"] },
]
export function matchesFilter(status: string, filter: StatusFilter): boolean {
  const f = STATUS_FILTERS.find((x) => x.id === filter)!
  return f.statuses.length === 0 || f.statuses.includes(status)
}

/** Rótulo do envio no singular feminino ("a mensagem"): Na fila · Enviando · Enviada · Falhou · Bloqueada · Cancelada. */
export const sendLabel = (status: string) =>
  ({ pendente: "Na fila", enviando: "Enviando", enviado: "Enviada", falhou: "Falhou", bloqueado: "Bloqueada", cancelado: "Cancelada" } as Record<string, string>)[status] ?? status

/** Resposta do cliente ao lembrete: SIM confirma a presença, NÃO avisa que não vai (não cancela); o resto foi ignorado ou rejeitado. */
export function replyKind(motivo: string | null, status: string): "confirmou" | "nao_vai" | "outra" {
  // a reserva já nasce confirmada: o SIM do cliente costuma cair em "ja_confirmado", e ainda assim é a confirmação dele
  if ((status === "processado" && motivo === "sim") || motivo === "ja_confirmado") return "confirmou"
  if (status === "processado" && (motivo === "nao" || motivo === "reagendar" || motivo === "nao_reagendar")) return "nao_vai"
  return "outra"
}

/** Estado do canal WhatsApp numa definição só: a faixa da aba Mensagens e o cartão de canais da aba Notificações leem daqui. */
export function whatsappState(status: string): { title: string; text: string; label: string; variant: "income" | "warning"; active: boolean } {
  if (status === "ativo") return { title: "WhatsApp ativo", text: "Os avisos autorizados pelos clientes são enviados automaticamente.", label: "Ativo", variant: "income", active: true }
  if (status === "suspenso") return { title: "WhatsApp suspenso", text: "O envio está pausado: os avisos ficam bloqueados até o canal voltar.", label: "Suspenso", variant: "warning", active: false }
  return { title: "WhatsApp não configurado", text: "Os avisos permanecem bloqueados até que a integração seja ativada no servidor.", label: "Inativo", variant: "warning", active: false }
}

/* ---------- Confirmação e lembrete automáticos (barbershops.reminder_config) ---------- */

export const REMINDER_LEAD_TIMES = [15, 30, 60, 120] as const
export type ReminderLeadTime = (typeof REMINDER_LEAD_TIMES)[number]
export type ReminderSettings = { auto_confirmation: boolean; auto_reminder: boolean; lead_time_minutes: ReminderLeadTime }

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { auto_confirmation: true, auto_reminder: true, lead_time_minutes: 30 }

/** Lê o jsonb do banco sem confiar no formato: campo ausente ou inválido volta ao padrão (30 min, tudo ligado). */
export function normalizeReminderSettings(raw: unknown): ReminderSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const lead = Number(r.lead_time_minutes)
  return {
    auto_confirmation: typeof r.auto_confirmation === "boolean" ? r.auto_confirmation : DEFAULT_REMINDER_SETTINGS.auto_confirmation,
    auto_reminder: typeof r.auto_reminder === "boolean" ? r.auto_reminder : DEFAULT_REMINDER_SETTINGS.auto_reminder,
    lead_time_minutes: (REMINDER_LEAD_TIMES as readonly number[]).includes(lead) ? (lead as ReminderLeadTime) : DEFAULT_REMINDER_SETTINGS.lead_time_minutes,
  }
}

/**
 * Instante de envio do lembrete (ISO) = início − antecedência.
 * `null` quando o início, a antecedência ou o resultado não formam uma data válida: a tela mostra "Prévia indisponível".
 */
export function reminderSendAt(inicio: string | null | undefined, leadMinutes: unknown): string | null {
  if (!inicio) return null
  const start = new Date(inicio).getTime()
  const lead = typeof leadMinutes === "number" ? leadMinutes : Number.NaN
  if (!Number.isFinite(start) || !Number.isFinite(lead) || lead < 0) return null
  const at = new Date(start - lead * 60_000)
  return Number.isFinite(at.getTime()) ? at.toISOString() : null
}

/** Formata sem derrubar a tela: data inválida ou fuso desconhecido devolvem `null`. */
export function safeFormat(iso: string | null | undefined, format: (iso: string) => string): string | null {
  if (!iso || !Number.isFinite(new Date(iso).getTime())) return null
  try {
    return format(iso)
  } catch {
    return null
  }
}
