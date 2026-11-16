// Texto das mensagens ao cliente (F08-04). Módulo puro.

export type EventPayload = {
  servico?: string
  profissional?: string
  inicio?: string
  fim?: string
  fuso?: string
  barbearia?: string
  endereco?: string | null
  cliente?: string
  lead_time_minutes?: number
  /** Retorno do cliente: há quanto tempo ele não volta ("3 meses"), calculado pelo agendador. */
  periodo?: string
}

/** 11912345678 → 5511912345678 (formato internacional que a API do WhatsApp exige). */
export function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits
}

function when(inicio: string, fuso: string): { dia: string; hora: string } {
  const date = new Date(inicio)
  const dia = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, weekday: "long", day: "2-digit", month: "2-digit" }).format(date)
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hour12: false }).format(date)
  return { dia, hora }
}

/** Fim de todo lembrete: a resposta que o webhook entende. O NÃO não cancela: a barbearia oferece reagendar. */
export const REMINDER_REPLY = "📲 Confirme sua presença:\n✅ Responda *SIM* para confirmar.\n❌ Responda *NÃO* se não puder comparecer."
/** Acrescenta a instrução ao lembrete, a menos que o texto da barbearia já peça o SIM (texto antigo salvo sem ela). */
export const withReminderReply = (texto: string) => (/\bSIM\b/.test(texto) ? texto : `${texto}\n\n${REMINDER_REPLY}`)

/** Área do cliente na barbearia (login + Reagendar da própria reserva): `APP_URL` + slug. */
export const rescheduleLink = (appUrl: string, slug: string, bookingId: string) =>
  `${appUrl.replace(/\/+$/, "")}/${encodeURIComponent(slug)}/minhas-reservas?reagendar=${encodeURIComponent(bookingId)}`

/**
 * Resposta automática ao que process_whatsapp_reply acabou de registrar (motivo de inbound_webhook_events); null = não responder.
 * 1ª resposta: sim | nao. 2ª, depois do NÃO: reagendar (SIM, precisa do link) | nao_reagendar (NÃO).
 */
export function replyAck(motivo: string | null | undefined, barbearia: string, link?: string | null): string | null {
  if (motivo === "sim") return `Obrigado por confirmar, ${barbearia} agradece!`
  if (motivo === "nao") return "Obrigado por responder! Gostaria de reagendar? Responda SIM ou NÃO."
  if (motivo === "reagendar") return link ? `Perfeito! Escolha seu novo horário: ${link}` : null
  if (motivo === "nao_reagendar") return "Tudo bem! A barbearia será avisada."
  return null
}

/** Devolve o texto ao cliente, ou null quando o evento não é uma mensagem (ex.: eventos de calendário). */
export function buildMessage(tipo: string, p: EventPayload): string | null {
  const { dia, hora } = when(p.inicio ?? new Date().toISOString(), p.fuso ?? "America/Sao_Paulo")
  const nome = p.cliente ? `Olá, ${p.cliente.split(" ")[0]}! ` : "Olá! "
  const onde = p.endereco ? `\nEndereço: ${p.endereco}` : ""
  const detalhe = `${p.servico ?? "Atendimento"} com ${p.profissional ?? "nossa equipe"}, ${dia} às ${hora}.${onde}`
  const casa = p.barbearia ?? "a barbearia"

  switch (tipo) {
    case "reserva_criada":
      return `${nome}Sua reserva em ${casa} está registrada.\n${detalhe}\n\n${REMINDER_REPLY}`
    case "reserva_confirmada":
      return `${nome}Sua reserva em ${casa} está confirmada.\n${detalhe}`
    case "reserva_reagendada": {
      if (!p.cliente || !p.servico || !p.inicio || !p.fim) return null
      const duracao = leadTimeLabel((Date.parse(p.fim) - Date.parse(p.inicio)) / 60_000)
      if (!duracao) return null
      return `✅ ${p.cliente}, seu reagendamento foi confirmado para as ${hora}!\n\n✂️ ${p.servico} — ${duracao}.\n\n⚠️ *Atenção:* chegue pontualmente. Em caso de atraso, seu atendimento poderá ser cancelado conforme as regras da barbearia.`
    }
    case "reserva_cancelada":
      return `${nome}Sua reserva em ${casa} foi cancelada.\n${detalhe}`
    case "lembrete_24h":
      return `${nome}Lembrete: amanhã você tem horário em ${casa} (em 24h).\n${detalhe}\n\n${REMINDER_REPLY}`
    case "lembrete_2h":
      return `${nome}Seu horário em ${casa} é daqui a 2 horas.\n${detalhe}`
    case "atendimento_concluido":
      return `${nome}Obrigado pela visita a ${casa}! Até a próxima.`
    default:
      // Sem "daqui a X": o agendador pode rodar depois do horário previsto; a data e a hora vêm em `detalhe`.
      if (/^lembrete_\d+min$/.test(tipo)) {
        return `${nome}Lembrete: seu horário em ${casa} está chegando.\n${detalhe}`
      }
      if (/^reativacao_\d+$/.test(tipo)) {
        return `${nome}Faz um tempo que não vemos você em ${casa}. Que tal agendar seu próximo horário?\nPara não receber mais novidades, responda PARAR.`
      }
      return null
  }
}

/* ---------- Textos editáveis pela barbearia (confirmação e lembrete, migration 0019) ---------- */

/** Variáveis que a barbearia pode usar no texto. `exemplo` alimenta a prévia da tela. */
export const MESSAGE_VARIABLES = [
  { chave: "nome", rotulo: "Primeiro nome", exemplo: "João" },
  { chave: "cliente", rotulo: "Nome completo", exemplo: "João Silva" },
  { chave: "servico", rotulo: "Serviço", exemplo: "Corte + Barba" },
  { chave: "profissional", rotulo: "Profissional", exemplo: "Carlos Barbosa" },
  { chave: "data", rotulo: "Data", exemplo: "09/11" },
  { chave: "dia_semana", rotulo: "Dia da semana", exemplo: "segunda-feira" },
  { chave: "hora", rotulo: "Hora", exemplo: "08:30" },
  { chave: "barbearia", rotulo: "Barbearia", exemplo: "Barbearia Exemplo" },
  { chave: "endereco", rotulo: "Endereço", exemplo: "Rua das Flores, 123 - Centro" },
  { chave: "antecedencia", rotulo: "Antecedência (lembrete)", exemplo: "1 hora" },
  { chave: "falta", rotulo: "Quanto falta (lembrete)", exemplo: "Falta 1 hora" },
  { chave: "periodo", rotulo: "Tempo sem voltar (retorno)", exemplo: "3 meses" },
] as const

/** Variáveis que fazem sentido em cada mensagem (os botões do editor). */
export const VARIABLES_BY_TYPE: Record<"confirmacao" | "lembrete" | "retorno", readonly string[]> = {
  confirmacao: ["nome", "cliente", "servico", "profissional", "data", "dia_semana", "hora", "barbearia", "endereco"],
  lembrete: ["nome", "cliente", "servico", "profissional", "data", "dia_semana", "hora", "barbearia", "endereco", "antecedencia", "falta"],
  retorno: ["nome", "cliente", "servico", "profissional", "data", "dia_semana", "barbearia", "endereco", "periodo"],
}
export type MessageVariable = (typeof MESSAGE_VARIABLES)[number]["chave"]

/** Texto padrão (o mesmo que a migration 0019 grava como valor inicial de cada barbearia). */
export const DEFAULT_TEMPLATES = {
  confirmacao: "✅ Olá, {nome}! Seu agendamento está confirmado.\n\n✂️ Serviço: {servico}\n👤 Profissional: {profissional}\n📅 Data: {data}\n🕔 Horário: {hora}\n📍 Local: {barbearia}",
  lembrete: "⏰ Olá, {nome}! {falta} para o seu atendimento!\n\n✂️ Serviço: {servico}\n👤 Profissional: {profissional}\n📅 Data: {data}\n🕔 Horário: {hora}\n📍 Local: {barbearia}\n\n" + REMINDER_REPLY,
  retorno: "👋 Olá, {nome}! Sentimos sua falta na {barbearia}.\n\n✂️ Último atendimento: {servico}\n👤 Profissional: {profissional}\n📅 Data: {data}\n\nJá faz {periodo}. Que tal agendar o próximo horário?\n\nSe não quiser mais receber estas mensagens, é só responder avisando.",
} as const

/** "Falta 1 hora", "Faltam 30 minutos", "Faltam 2 horas" (concordância pelo número). */
export function timeLeftLabel(min: number | undefined): string {
  const rotulo = leadTimeLabel(min)
  if (!rotulo) return ""
  return `${rotulo.startsWith("1 ") ? "Falta" : "Faltam"} ${rotulo}`
}

/** 30 → "30 minutos", 60 → "1 hora", 120 → "2 horas". */
export function leadTimeLabel(min: number | undefined): string {
  if (!min || !Number.isFinite(min)) return ""
  if (min % 60 === 0) return min === 60 ? "1 hora" : `${min / 60} horas`
  return `${min} minutos`
}

/** Valores das variáveis a partir do payload da fila. Opcionais (endereço, antecedência) podem vir vazios. */
export function messageVariables(p: EventPayload): Record<MessageVariable, string> {
  const inicio = new Date(p.inicio ?? new Date().toISOString())
  const fuso = p.fuso ?? "America/Sao_Paulo"
  const { hora } = when(inicio.toISOString(), fuso)
  const data = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit" }).format(inicio)
  const diaSemana = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, weekday: "long" }).format(inicio)
  const cliente = (p.cliente ?? "").trim()
  return {
    nome: cliente.split(/\s+/)[0] || "cliente",
    cliente: cliente || "cliente",
    servico: p.servico ?? "Atendimento",
    profissional: p.profissional ?? "nossa equipe",
    data,
    dia_semana: diaSemana,
    hora,
    barbearia: p.barbearia ?? "a barbearia",
    endereco: (p.endereco ?? "").trim(),
    antecedencia: leadTimeLabel(p.lead_time_minutes),
    falta: timeLeftLabel(p.lead_time_minutes),
    periodo: (p.periodo ?? "").trim(),
  }
}

/**
 * Troca {variavel} pelo valor. Uma linha cuja variável ficou vazia sai inteira (ex.: "Endereço: {endereco}" sem endereço).
 * Chave desconhecida fica como está, para a barbearia ver que digitou errado.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  const linhas = template.replace(/\r\n?/g, "\n").split("\n").flatMap((linha) => {
    let vazia = false
    const pronta = linha.replace(/\{([a-z_]+)\}/g, (todo, chave: string) => {
      if (!(chave in vars)) return todo
      const valor = vars[chave] ?? ""
      if (!valor) vazia = true
      return valor
    })
    return vazia ? [] : [pronta.trimEnd()]
  })
  return linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}
