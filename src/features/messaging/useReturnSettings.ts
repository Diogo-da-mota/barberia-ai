import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/ui/sonner"
import { DEFAULT_TEMPLATES } from "../../../supabase/functions/_shared/messages"
import { fetchReturnSettings, saveReturnSettings, type ReturnSettings, type ReturnUnit } from "./api"

/** Máximo por unidade (o mesmo da migration 0020). */
export const RETURN_LIMITS: Record<ReturnUnit, number> = { dias: 365, semanas: 52, meses: 24 }
const PADRAO: ReturnSettings = { ativo: false, quantidade: 1, unidade: "meses", texto: DEFAULT_TEMPLATES.retorno }

/** "3 meses", "1 semana", "10 dias" (igual a private.retorno_periodo). */
export function returnPeriodLabel(quantidade: number, unidade: ReturnUnit): string {
  const um = quantidade === 1
  const nome = unidade === "dias" ? (um ? "dia" : "dias") : unidade === "semanas" ? (um ? "semana" : "semanas") : um ? "mês" : "meses"
  return `${quantidade} ${nome}`
}

/** Retorno do cliente: liga/desliga, prazo (N dias/semanas/meses) e texto. Sem a migration 0020, só leitura com o padrão. */
export function useReturnSettings(shopId: string) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ["return-settings", shopId], queryFn: () => fetchReturnSettings(shopId), staleTime: 30000 })
  const supported = query.data !== null && query.data !== undefined
  const [draft, setDraft] = useState<ReturnSettings | null>(null)
  const settings: ReturnSettings = draft ?? query.data ?? PADRAO

  const mutation = useMutation({
    mutationFn: (next: ReturnSettings & { salvarTexto?: boolean }) =>
      saveReturnSettings(shopId, { ativo: next.ativo, quantidade: next.quantidade, unidade: next.unidade, texto: next.salvarTexto ? next.texto : undefined }),
    onSuccess: (_, next) => {
      queryClient.setQueryData(["return-settings", shopId], { ativo: next.ativo, quantidade: next.quantidade, unidade: next.unidade, texto: next.texto.trim() })
      setDraft(null)
      toast.success(next.salvarTexto ? "Texto salvo. As próximas mensagens já saem com ele." : "Retorno do cliente atualizado.")
    },
    onError: () => {
      setDraft(null)
      toast.error("Não foi possível salvar o retorno do cliente. Tente novamente.")
    },
  })

  const change = (patch: Partial<Omit<ReturnSettings, "texto">>) => {
    const next = { ...settings, ...patch }
    next.quantidade = Math.min(Math.max(1, Math.round(next.quantidade || 1)), RETURN_LIMITS[next.unidade])
    setDraft(next)
    mutation.mutate(next)
  }
  const saveText = (texto: string) => mutation.mutate({ ...settings, texto, salvarTexto: true })

  return { settings, supported, loading: query.isPending, saving: mutation.isPending, change, saveText }
}
