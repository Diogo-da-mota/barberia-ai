import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { toast } from "@/ui/sonner"
import { saveSiteProfile, type ReminderConfig } from "@/features/site/api"
import { DEFAULT_REMINDER_SETTINGS, normalizeReminderSettings } from "./domain"

/**
 * Confirmação e lembrete automáticos da barbearia (barbershops.reminder_config).
 * Uma lógica só para as chaves de "Mensagens ao cliente" e os cards "Confirmação automática" / "Lembrete automático".
 * Chave própria: ["site-profile", id] é do editor Meu site e guarda o perfil inteiro (não só o reminder_config).
 */
export function useReminderConfig(shopId: string) {
  const queryClient = useQueryClient()
  const { data: savedConfig } = useQuery({
    queryKey: ["reminder-config", shopId],
    queryFn: async () => {
      const { data, error } = await supabase.from("barbershops").select("reminder_config").eq("id", shopId).single()
      if (error) throw error
      return normalizeReminderSettings(data?.reminder_config)
    },
    staleTime: 30000,
  })
  // Alteração ainda não confirmada pelo banco; sem ela, vale o que foi gravado (ou o padrão).
  const [draft, setDraft] = useState<ReminderConfig | null>(null)
  const config: ReminderConfig = draft ?? savedConfig ?? DEFAULT_REMINDER_SETTINGS

  const saveMutation = useMutation({
    mutationFn: async (newConfig: ReminderConfig) => {
      // Buscar dados atuais do perfil para não perder outros campos
      const { data: current } = await supabase.from("barbershops").select("descricao, cor_destaque, endereco, telefone").eq("id", shopId).single()
      await saveSiteProfile({
        shopId,
        descricao: current?.descricao ?? "",
        cor: current?.cor_destaque,
        endereco: current?.endereco ?? "",
        telefone: current?.telefone ?? "",
        reminderConfig: newConfig,
      })
      return newConfig
    },
    onSuccess: async (newConfig) => {
      queryClient.setQueryData(["reminder-config", shopId], newConfig)
      setDraft(null)
      await queryClient.invalidateQueries({ queryKey: ["site-profile", shopId] })
      toast.success("Configurações salvas.")
    },
    onError: () => {
      setDraft(null)
      toast.error("Não foi possível salvar. Tente novamente.")
    },
  })

  const change = (field: keyof ReminderConfig, value: boolean | number) => {
    const newConfig = { ...config, [field]: value } as ReminderConfig
    setDraft(newConfig)
    saveMutation.mutate(newConfig)
  }

  return { config, saving: saveMutation.isPending, change }
}
