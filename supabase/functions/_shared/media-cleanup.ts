/**
 * Limpeza dos envios órfãos ao S3 (migration 0041): o banco devolve os envios com mais de 24 h que nenhum registro usa
 * (list_orphan_media); cada um é apagado no S3 e só os apagados com sucesso são marcados (mark_media_removed). Imagens
 * registradas e imagens anteriores à 0041 nunca entram na lista. Lógica pura: o banco (rpc) e o S3 (apagar) chegam de fora.
 */
import type { Rpc } from "./whatsapp-outbox.ts"

export type Apagar = (key: string) => Promise<void>
export type ResultadoLimpeza = { encontrados: number; apagados: number; falhas: number }

export async function limparOrfaos(rpc: Rpc, apagar: Apagar, limite = 100): Promise<ResultadoLimpeza> {
  const lista = await rpc("list_orphan_media", { p_limit: limite })
  if (lista.error) throw new Error(`list_orphan_media: ${lista.error.message}`)
  const keys = ((lista.data as { key?: unknown }[] | null) ?? [])
    .map((linha) => linha.key)
    .filter((key): key is string => typeof key === "string" && key.startsWith("BARBEARIA/"))
  const apagadas: string[] = []
  let falhas = 0
  for (const key of keys) {
    try {
      await apagar(key)
      apagadas.push(key)
    } catch {
      falhas++
    }
  }
  if (apagadas.length > 0) {
    const marcado = await rpc("mark_media_removed", { p_keys: apagadas })
    if (marcado.error) throw new Error(`mark_media_removed: ${marcado.error.message}`)
  }
  return { encontrados: keys.length, apagados: apagadas.length, falhas }
}
