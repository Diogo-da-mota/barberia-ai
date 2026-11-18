import { isMissingSchema } from "@/features/booking/domain"
import { supabase } from "@/lib/supabase"
import type { DeletionRequest, LeaveResult, LeaveSummary } from "../account"

/**
 * Saída da barbearia e pedido de exclusão (migration 0057). Nenhuma chamada envia id de conta ou de card: o servidor usa
 * só a pessoa do token. A exclusão em si continua em `deleteMyAccount` (services/auth.ts).
 */
export async function fetchLeaveSummary(shopId: string): Promise<LeaveSummary> {
  const { data, error } = await supabase.rpc("get_leave_summary", { p_barbershop_id: shopId })
  if (error) throw error
  return data as LeaveSummary
}

export async function leaveBarbershop(shopId: string): Promise<LeaveResult> {
  const { data, error } = await supabase.rpc("leave_barbershop", { p_barbershop_id: shopId })
  if (error) throw error
  return data as LeaveResult
}

/** Pedido para atendimento manual quando a exclusão automática não conclui (dono de barbearia, reserva futura). */
export async function requestAccountDeletion(): Promise<DeletionRequest> {
  const { data, error } = await supabase.rpc("request_account_deletion")
  if (error) throw error
  return data as DeletionRequest
}

/** Pedido pendente da própria conta (o RLS só devolve a própria linha). Banco sem a 0057: `supported: false`. */
export async function fetchMyDeletionRequest(): Promise<{ supported: boolean; pending: DeletionRequest | null }> {
  const { data, error } = await supabase.from("account_deletion_requests").select("id, status, bloqueios, criado_em").eq("status", "pendente").maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return { supported: false, pending: null }
    throw error
  }
  return { supported: true, pending: (data as DeletionRequest | null) ?? null }
}
