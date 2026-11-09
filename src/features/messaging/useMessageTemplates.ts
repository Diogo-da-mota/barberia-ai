import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/ui/sonner"
import { DEFAULT_TEMPLATES } from "../../../supabase/functions/_shared/messages"
import { fetchMessageTemplates, saveMessageTemplates, type MessageTemplates } from "./api"

/** Textos da confirmação e do lembrete da barbearia. Sem a migration 0019, valem os textos padrão (só leitura). */
export function useMessageTemplates(shopId: string) {
  const queryClient = useQueryClient()
  const key = ["message-templates", shopId]
  const query = useQuery({ queryKey: key, queryFn: () => fetchMessageTemplates(shopId), staleTime: 30000 })
  const templates: MessageTemplates = query.data ?? { supported: false, confirmacao: DEFAULT_TEMPLATES.confirmacao, lembrete: DEFAULT_TEMPLATES.lembrete }

  const mutation = useMutation({
    mutationFn: (next: { confirmacao: string; lembrete: string }) => saveMessageTemplates(shopId, next.confirmacao, next.lembrete),
    onSuccess: (_, next) => {
      queryClient.setQueryData(["message-templates", shopId], { supported: true, confirmacao: next.confirmacao.trim(), lembrete: next.lembrete.trim() })
      toast.success("Texto salvo. As próximas mensagens já saem com ele.")
    },
    onError: (err) => {
      const msg = (err as { message?: string })?.message ?? ""
      toast.error(msg.includes("invalid_template") ? "O texto precisa ter de 1 a 1000 caracteres." : "Não foi possível salvar o texto. Tente novamente.")
    },
  })

  const save = (tipo: "confirmacao" | "lembrete", texto: string) =>
    mutation.mutate({ confirmacao: tipo === "confirmacao" ? texto : templates.confirmacao, lembrete: tipo === "lembrete" ? texto : templates.lembrete })

  return { templates, loading: query.isPending, save, saving: mutation.isPending }
}
