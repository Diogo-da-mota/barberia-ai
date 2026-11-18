/**
 * Ponte do alerta de segurança para o Telegram (migration 0055): o banco guarda os alertas e o token/chat no Vault, mas não
 * alcança api.telegram.org; esta função lê os pendentes (alerta_telegram_pendentes), envia cada um e marca o resultado
 * (alerta_telegram_resultado). Não aceita texto de fora: só envia o que o banco gerou. O token nunca vai para o resultado.
 * Lógica pura: o banco (rpc) e o envio HTTP (enviar) chegam de fora.
 */
import type { Rpc } from "./whatsapp-outbox.ts"

type Pendentes = { token?: string | null; chat_id?: string | null; itens?: { id: number; mensagem: string }[] }
export type ResultadoPonte = { enviados: number; falhas: number }

export async function enviarAlertasPendentes(rpc: Rpc, enviar: typeof fetch): Promise<ResultadoPonte> {
  const lista = await rpc("alerta_telegram_pendentes")
  if (lista.error) throw new Error(`alerta_telegram_pendentes: ${lista.error.message}`)
  const { token, chat_id: chat, itens = [] } = (lista.data ?? {}) as Pendentes
  let enviados = 0
  let falhas = 0
  for (const item of itens) {
    let erro: string | null = null
    if (!token || !chat) {
      erro = "segredo_ausente_no_vault"
    } else {
      try {
        const res = await enviar(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chat, text: item.mensagem }),
          signal: AbortSignal.timeout(15_000),
        })
        if (!res.ok) erro = `telegram_${res.status}`
      } catch {
        erro = "telegram_indisponivel"
      }
    }
    const marcado = await rpc("alerta_telegram_resultado", { p_id: item.id, p_ok: erro === null, p_erro: erro })
    if (marcado.error) throw new Error(`alerta_telegram_resultado: ${marcado.error.message}`)
    if (erro) falhas++
    else enviados++
  }
  return { enviados, falhas }
}
