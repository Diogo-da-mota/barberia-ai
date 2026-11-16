import { supabase } from "@/lib/supabase"
import { functionError } from "./whatsapp-api"

export type AiProvider = "openai" | "anthropic"
/** O que o navegador sabe da chave: nunca a chave, só o provedor, os 4 últimos caracteres e a data (Edge Function ai-credentials). */
export type AiConnection = { provedor: AiProvider; final: string; atualizado_em: string } | null

async function call(body: Record<string, unknown>): Promise<AiConnection> {
  const { data, error } = await supabase.functions.invoke("ai-credentials", { body })
  if (error) throw await functionError(error, "ai_credentials_failed")
  return (data as { conexao: AiConnection }).conexao
}

export const fetchAiConnection = (shopId: string) => call({ barbearia: shopId })
export const saveAiKey = (shopId: string, provedor: AiProvider, chave: string) => call({ barbearia: shopId, provedor, chave })
export const removeAiKey = (shopId: string) => call({ barbearia: shopId, remover: true })

/** Instruções da Lara desta barbearia (o servidor junta às regras fixas em cada conversa). null: banco sem a migration 0025. */
export async function fetchLaraInstructions(shopId: string): Promise<string | null> {
  const { data, error } = await supabase.from("barbershops").select("assistente_instrucoes").eq("id", shopId).single()
  if (error) {
    if (error.code === "42703") return null
    throw error
  }
  return (data as { assistente_instrucoes: string }).assistente_instrucoes
}

export async function saveLaraInstructions(shopId: string, texto: string): Promise<void> {
  const { error } = await supabase.rpc("save_assistant_instructions", { p_barbershop_id: shopId, p_texto: texto })
  if (error) throw error
}

export type ChatMessage = { role: "user" | "assistant"; content: string }

/** Pergunta à assistente (Edge Function assistant): a barbearia é conferida pela sessão no servidor; só as últimas 20 mensagens vão. */
export async function askAssistant(shopId: string, mensagens: ChatMessage[]): Promise<string> {
  const { data, error } = await supabase.functions.invoke("assistant", { body: { barbearia: shopId, mensagens: mensagens.slice(-20) } })
  if (error) throw await functionError(error, "assistant_failed")
  return (data as { resposta: string }).resposta
}
