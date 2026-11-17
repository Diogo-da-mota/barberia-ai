const PLANS: Record<string, string> = { inicial: "Inicial", profissional: "Profissional", rede: "Rede" }
export const planLabel = (id: string) => PLANS[id] ?? id

const STATUS: Record<string, string> = {
  trial: "Período de teste", ativa: "Ativa", inadimplente: "Pagamento pendente", suspensa: "Suspensa", cancelada: "Cancelada",
}
export const planStatusLabel = (status: string) => STATUS[status] ?? status
export function planStatusVariant(status: string): "income" | "info" | "warning" | "danger" | "default" {
  return ({ ativa: "income", trial: "info", inadimplente: "warning", suspensa: "danger", cancelada: "danger" } as Record<string, "income" | "info" | "warning" | "danger">)[status] ?? "default"
}

export function usageText(ativos: number, max: number | null): string {
  if (max === null) return `${ativos} ${ativos === 1 ? "profissional ativo" : "profissionais ativos"} (sem limite)`
  return `${ativos} de ${max} profissionais ativos`
}

/** WhatsApp do desenvolvedor para aumentar o limite (ainda não há sistema de assinatura). */
export const LIMIT_CONTACT_WHATSAPP = "5564993296649"

/** Link do WhatsApp com a mensagem pronta, usando o nome real da barbearia (texto codificado na URL). */
export function planLimitWhatsAppUrl(shopName: string): string {
  const text = `Olá! Sou responsável pela barbearia ${shopName} e gostaria de aumentar o limite de profissionais da minha equipe. Podem me ajudar?`
  return `https://wa.me/${LIMIT_CONTACT_WHATSAPP}?text=${encodeURIComponent(text)}`
}

/** Mensagem dos erros de limite do servidor; null quando o erro não é de plano. */
export function planErrorMessage(error: unknown): string | null {
  const { message } = (error ?? {}) as { message?: string }
  if (message === "plan_limit") return "Você atingiu o limite de profissionais do seu plano. Desative alguém ou mude de plano."
  if (message === "subscription_inactive") return "A assinatura desta barbearia está inativa. Regularize para voltar a usar este recurso."
  if (message === "shop_limit") return "Cada proprietário pode ter até 3 barbearias."
  return null
}
