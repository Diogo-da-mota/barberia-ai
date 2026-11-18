import type { MyBarbershop, Papel } from "@/features/home/domain"

/**
 * Saída da barbearia e exclusão da conta (migration 0057). Só decide o que a tela mostra: quem protege é o servidor
 * (a pessoa vem do token, login recente pelo `amr`, RLS). Política completa: Docs/LGPD-SAIDA-EXCLUSAO.md.
 */

/** Resposta de get_leave_summary: só os dados do próprio card naquela barbearia. */
export type LeaveSummary = {
  papel: Papel | null
  pode_sair: boolean
  reservas_futuras?: number
  comissoes_a_receber_centavos?: number
  google_agenda?: boolean
}

export type LeaveResult = { status: "saiu" | "ja_saiu"; reservas_futuras: number }

export type DeletionRequest = { id: string; status: "pendente" | "concluido" | "cancelado"; bloqueios: string[]; criado_em: string }

/** Barbearias de onde a pessoa pode sair por conta própria: equipe sem ser dona (dono precisa transferir pelo suporte). */
export function leavableShops(shops: MyBarbershop[]): MyBarbershop[] {
  return shops.filter((shop) => shop.papel === "barbeiro" || shop.papel === "gerente")
}

export function ownedShops(shops: MyBarbershop[]): MyBarbershop[] {
  return shops.filter((shop) => shop.papel === "proprietario")
}

const code = (error: unknown) => String((error as { message?: unknown } | null)?.message ?? "")

/** Recusa que pede reautenticação (login há mais de 15 min). */
export const needsReauth = (error: unknown) => code(error) === "reauth_required"

/** Recusas em que a exclusão automática não conclui, mas o pedido de exclusão pode ser registrado para atendimento. */
export const canRequestDeletion = (error: unknown) => code(error) === "owner_cannot_delete" || code(error) === "has_upcoming_bookings"

const LEAVE_MESSAGES: Record<string, string> = {
  owner_cannot_leave: "O proprietário não sai da própria barbearia por aqui. Para transferir a barbearia, registre um pedido ao suporte.",
  not_authenticated: "Sua sessão expirou. Entre novamente.",
}

export function leaveErrorMessage(error: unknown): string {
  return LEAVE_MESSAGES[code(error)] ?? "Não foi possível sair da barbearia. Tente novamente."
}

/** Login com e-mail e senha (reautentica pela senha); só Google reautentica escolhendo a conta Google de novo. */
export function loginMethods(user: { app_metadata?: { providers?: unknown; provider?: unknown } } | null | undefined) {
  const meta = user?.app_metadata ?? {}
  const providers = Array.isArray(meta.providers) ? meta.providers.map(String) : typeof meta.provider === "string" ? [meta.provider] : []
  return { password: providers.includes("email"), google: providers.includes("google") }
}

/** O que acontece com cada dado ao excluir a conta (o mesmo texto para cliente e equipe). */
export const DELETION_EFFECTS = {
  apagado: [
    "Seu login, sessões abertas, perfil, preferências e consentimentos.",
    "Seu vínculo com todas as barbearias e o acesso ao painel.",
    "Na equipe: sua foto, telefone e e-mail do cadastro de profissional, a conexão com o Google Agenda e convites pendentes.",
  ],
  anonimizado: [
    "Reservas antigas em que você foi cliente ficam na barbearia sem seu nome, WhatsApp e e-mail.",
    "Avisos de WhatsApp ficam sem telefone e texto; os que ainda iam sair são cancelados.",
  ],
  conservado: [
    "Na equipe: seu nome e documento no histórico da barbearia (atendimentos, comissões e repasses), por obrigação legal e fiscal da barbearia.",
    "Pagamentos, estornos e lançamentos financeiros da barbearia, sem ligação com a sua conta.",
  ],
} as const
