/**
 * Escopo "confirmacoes_lembretes" do outbox-worker (disparado pelo n8n a cada minuto):
 * agenda os lembretes e o retorno do cliente, reivindica confirmações, lembretes e retornos do WhatsApp e entrega cada um pela instância Evolution
 * da própria barbearia, registrando o resultado na fila (complete_outbox: enviado, ou nova tentativa/falhou com o erro).
 * Lógica pura: o banco (rpc) e o envio (sendText) chegam de fora, para rodar igual no Deno e nos testes.
 */
import { buildMessage, messageVariables, renderTemplate, toE164, withReminderReply, type EventPayload } from "./messages.ts"

export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
/** Envia o texto pela instância e devolve o id da mensagem no provedor. */
export type SendText = (instancia: string, numero: string, texto: string) => Promise<string>
/** `modelo`: texto da barbearia (migration 0019); sem ele, vale o texto padrão de buildMessage. */
export type ItemFila = { id: string; barbershop_id: string; tipo: string; destino: string; payload: Record<string, unknown>; instancia: string | null; modelo?: string | null }
export type Resultado = { agendados: number; recebidos: number; enviados: number; falhas: number }

export async function processarConfirmacoesELembretes(rpc: Rpc, sendText: SendText, limite = 20): Promise<Resultado> {
  const agendado = await rpc("schedule_reminders")
  if (agendado.error) throw new Error(`schedule_reminders: ${agendado.error.message}`)
  const retorno = await rpc("schedule_reactivation")
  if (retorno.error) throw new Error(`schedule_reactivation: ${retorno.error.message}`)
  const { data, error } = await rpc("claim_whatsapp_outbox", { p_limit: limite })
  if (error) throw new Error(`claim_whatsapp_outbox: ${error.message}`)

  const fila = (data ?? []) as ItemFila[]
  let enviados = 0
  let falhas = 0
  for (const item of fila) {
    let providerId: string | null = null
    let erro: string | null = null
    try {
      if (!item.instancia) throw new Error("evolution_sem_instancia")
      const payload = item.payload as EventPayload
      const texto = item.modelo?.trim() ? renderTemplate(item.modelo, messageVariables(payload)) : buildMessage(item.tipo, payload)
      if (!texto) throw new Error("tipo_sem_mensagem")
      providerId = await sendText(item.instancia, toE164(item.destino), item.tipo.startsWith("lembrete_") ? withReminderReply(texto) : texto)
    } catch (err) {
      erro = (err instanceof Error ? err.message : "erro").slice(0, 300)
    }
    // Se o registro falhar, a linha fica "enviando" e volta à fila em 10 minutos (entrega pelo menos uma vez).
    await rpc("complete_outbox", { p_id: item.id, p_ok: erro === null, p_provider_message_id: providerId, p_erro: erro })
    if (erro === null) enviados++
    else falhas++
  }
  return { agendados: Number(agendado.data ?? 0) + Number(retorno.data ?? 0), recebidos: fila.length, enviados, falhas }
}
