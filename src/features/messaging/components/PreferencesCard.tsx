import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { isMissingSchema } from "@/features/booking/domain"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { Panel } from "@/ui/finance"
import { toast } from "@/ui/sonner"

/** Consentimento de novidades e promoções (marketing), separado dos avisos da reserva. O cliente liga e desliga a qualquer momento. */
export function PreferencesCard({ shopId, shopName }: { shopId: string; shopName: string }) {
  const { session } = useAuth()
  const userId = session?.user.id
  const queryClient = useQueryClient()
  const consent = useQuery({
    queryKey: ["marketing-consent", shopId, userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from("customer_consents").select("marketing").eq("barbershop_id", shopId).eq("profile_id", userId!).maybeSingle()
      if (error) throw error
      return Boolean(data?.marketing)
    },
  })
  const save = useMutation({
    mutationFn: async (marketing: boolean) => {
      const { error } = await supabase.rpc("set_marketing_consent", { p_barbershop_id: shopId, p_marketing: marketing })
      if (error) throw error
      return marketing
    },
    onSuccess: async (marketing) => {
      await queryClient.invalidateQueries({ queryKey: ["marketing-consent", shopId] })
      toast.success(marketing ? "Você vai receber novidades." : "Você não receberá mais novidades.")
    },
    onError: () => toast.error("Não foi possível salvar. Tente novamente."),
  })

  if (consent.isError && isMissingSchema(consent.error)) return null
  if (consent.data === undefined) return null
  return (
    <Panel className="p-4">
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 h-5 w-5 accent-primary" checked={consent.data} disabled={save.isPending} onChange={(e) => save.mutate(e.target.checked)} />
        <span>
          <span className="block text-base font-medium">Receber novidades de {shopName}</span>
          <span className="block text-muted-foreground">Promoções e lembretes para voltar. Você pode desligar quando quiser; os avisos da própria reserva não mudam.</span>
        </span>
      </label>
    </Panel>
  )
}
