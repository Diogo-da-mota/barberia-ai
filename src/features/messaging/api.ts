import { supabase } from "@/lib/supabase"

import type { BookingStatus } from "@/features/booking/domain"

/** Reserva ligada à mensagem (para abrir os dados e agir no pop-up). */
export type OutboxBooking = {
  id: string
  barbershop_id: string
  service_id: string | null
  professional_id: string
  servico_nome: string
  cliente_nome: string
  cliente_whatsapp: string
  preco_centavos: number
  inicio: string
  fim: string
  status: BookingStatus
  professionals: { nome: string; avatar_path?: string | null } | null
}

export type OutboxRow = {
  id: string
  tipo: string
  canal: string
  destino: string
  status: string
  tentativas: number
  max_tentativas: number
  ultimo_erro: string | null
  criado_em: string
  bookings: OutboxBooking | null
}
export type InboundRow = { id: string; status: string; motivo: string | null; recebido_em: string; booking_id: string | null }
export type IntegrationRow = { provider: string; status: string }

/** Apaga a mensagem (evento + registros de envio). Não mexe na reserva nem no financeiro. Só a gestão. */
export async function deleteOutboxEvent(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_outbox_event", { p_id: id })
  if (error) throw error
}

export async function fetchOutboxSummary(shopId: string): Promise<{ status: string; total: number }[]> {
  const { data, error } = await supabase.rpc("outbox_summary", { p_barbershop_id: shopId })
  if (error) throw error
  return ((data ?? []) as { status: string; total: number | string }[]).map((r) => ({ status: r.status, total: Number(r.total) }))
}

export async function fetchOutbox(shopId: string): Promise<OutboxRow[]> {
  const { data, error } = await supabase
    .from("outbox_events")
    .select("id, tipo, canal, destino, status, tentativas, max_tentativas, ultimo_erro, criado_em, bookings(id, barbershop_id, service_id, professional_id, servico_nome, cliente_nome, cliente_whatsapp, preco_centavos, inicio, fim, status, professionals(nome, avatar_path))")
    .eq("barbershop_id", shopId)
    .order("criado_em", { ascending: false })
    .limit(50)
  if (error) throw error
  return data as unknown as OutboxRow[]
}

export async function fetchInbound(shopId: string): Promise<InboundRow[]> {
  const { data, error } = await supabase
    .from("inbound_webhook_events")
    .select("id, status, motivo, recebido_em, booking_id")
    .eq("barbershop_id", shopId)
    .order("recebido_em", { ascending: false })
    .limit(30)
  if (error) throw error
  return data as InboundRow[]
}

export async function fetchIntegrations(shopId: string): Promise<IntegrationRow[]> {
  const { data, error } = await supabase.from("integration_accounts").select("provider, status").eq("barbershop_id", shopId)
  if (error) throw error
  return data as IntegrationRow[]
}

/* ---------- Textos da confirmação e do lembrete (migration 0019) ---------- */

export type MessageTemplates = { supported: boolean; confirmacao: string; lembrete: string }

/** `supported = false`: banco sem a migration 0019 (colunas ausentes); a tela mostra o texto padrão sem permitir salvar. */
export async function fetchMessageTemplates(shopId: string): Promise<MessageTemplates | null> {
  const { data, error } = await supabase.from("barbershops").select("msg_confirmacao, msg_lembrete").eq("id", shopId).single()
  if (error) {
    if (error.code === "42703") return null
    throw error
  }
  const row = data as { msg_confirmacao: string; msg_lembrete: string }
  return { supported: true, confirmacao: row.msg_confirmacao, lembrete: row.msg_lembrete }
}

export async function saveMessageTemplates(shopId: string, confirmacao: string, lembrete: string): Promise<void> {
  const { error } = await supabase.rpc("save_message_templates", { p_barbershop_id: shopId, p_confirmacao: confirmacao, p_lembrete: lembrete })
  if (error) throw error
}

/* ---------- Retorno do cliente (migration 0020) ---------- */

export type ReturnUnit = "dias" | "semanas" | "meses"
export type ReturnSettings = { ativo: boolean; quantidade: number; unidade: ReturnUnit; texto: string }

/** null: banco sem a migration 0020 (colunas ausentes). */
export async function fetchReturnSettings(shopId: string): Promise<ReturnSettings | null> {
  const { data, error } = await supabase.from("barbershops").select("retorno_ativo, retorno_quantidade, retorno_unidade, msg_retorno").eq("id", shopId).single()
  if (error) {
    if (error.code === "42703") return null
    throw error
  }
  const r = data as { retorno_ativo: boolean; retorno_quantidade: number; retorno_unidade: ReturnUnit; msg_retorno: string }
  return { ativo: r.retorno_ativo, quantidade: r.retorno_quantidade, unidade: r.retorno_unidade, texto: r.msg_retorno }
}

export async function saveReturnSettings(shopId: string, s: { ativo: boolean; quantidade: number; unidade: ReturnUnit; texto?: string }): Promise<void> {
  const { error } = await supabase.rpc("save_return_settings", { p_barbershop_id: shopId, p_ativo: s.ativo, p_quantidade: s.quantidade, p_unidade: s.unidade, p_texto: s.texto ?? null })
  if (error) throw error
}
