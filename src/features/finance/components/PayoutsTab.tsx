import { useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ProfessionalTag } from "@/features/catalog/components/ProfessionalPhoto"
import { formatPrice } from "@/features/catalog/domain"
import type { MyBarbershop } from "@/features/home/domain"
import { formatDateTime } from "@/features/booking/domain"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { EmptyState } from "@/ui/finance"
import { toast } from "@/ui/sonner"
import { createPayout, fetchCommissions, fetchPayouts } from "../api"
import { financeErrorMessage, newKey } from "../domain"
import { commissionsByProfessional } from "../summary"
import { Loading, QueryError, Section, StatStrip } from "./FinanceUI"

/** Repasses: o que cada profissional tem a receber e o histórico. Registrar um repasse só anota o pagamento: nenhum dinheiro é movimentado pelo sistema. */
export function PayoutsTab({ shop }: { shop: MyBarbershop }) {
  const queryClient = useQueryClient()
  const tz = shop.fuso ?? "America/Sao_Paulo"
  const commissions = useQuery({ queryKey: ["commissions", shop.id], queryFn: () => fetchCommissions(shop.id) })
  const payouts = useQuery({ queryKey: ["payouts", shop.id], queryFn: () => fetchPayouts(shop.id) })
  const payout = useMutation({
    mutationFn: (professionalId: string) => createPayout(professionalId, newKey()),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["commissions", shop.id] }),
        queryClient.invalidateQueries({ queryKey: ["payouts", shop.id] }),
        queryClient.invalidateQueries({ queryKey: ["finance-report", shop.id] }),
      ])
      toast.success("Repasse registrado.")
    },
    onError: (e) => toast.error(financeErrorMessage(e)),
  })
  const byProfessional = useMemo(() => commissionsByProfessional(commissions.data ?? []), [commissions.data])

  if (commissions.isError) return <QueryError error={commissions.error} onRetry={() => void commissions.refetch()} />
  if (payouts.isError) return <QueryError error={payouts.error} onRetry={() => void payouts.refetch()} />
  if (!commissions.data || !payouts.data) return <Loading label="Carregando repasses" />

  const pendente = byProfessional.reduce((t, p) => t + p.pendente, 0)
  const repassado = byProfessional.reduce((t, p) => t + p.repassado, 0)

  return (
    <div className="flex flex-col gap-4">
      <StatStrip items={[
        { label: "A repassar", value: formatPrice(pendente), tone: pendente > 0 ? "warning" : undefined },
        { label: "Já repassado", value: formatPrice(repassado), tone: "income" },
        { label: "Repasses feitos", value: String(payouts.data.length) },
      ]} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title="Valores por profissional" description="O repasse só registra o pagamento ao profissional: nenhum dinheiro é movimentado pelo sistema.">
          {byProfessional.length === 0 ? <EmptyState title="Nada a repassar" description="As comissões de atendimentos concluídos aparecem aqui." /> : (
            <ul className="divide-y divide-border">
              {byProfessional.map((p) => (
                <li key={p.id} className="grid grid-cols-2 items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))_auto]">
                  <span className="col-span-2 min-w-0 truncate text-base font-semibold sm:col-span-1"><ProfessionalTag nome={p.nome} path={p.avatar} /></span>
                  <span className="flex flex-col text-sm"><span className="text-xs text-muted-foreground">A repassar</span><span className={cn("font-display font-semibold tabular-nums", p.pendente > 0 && "text-warning")}>{formatPrice(p.pendente)}</span></span>
                  <span className="flex flex-col text-sm"><span className="text-xs text-muted-foreground">Repassado</span><span className="font-display font-semibold tabular-nums">{formatPrice(p.repassado)}</span></span>
                  <Button className="col-span-2 h-11 sm:col-span-1 md:h-10" disabled={payout.isPending || p.pendente === 0} onClick={() => payout.mutate(p.id)}>
                    {p.pendente > 0 ? `Repassar ${formatPrice(p.pendente)}` : "Nada a repassar"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Repasses realizados" className="self-start">
          {payouts.data.length === 0 ? <EmptyState title="Nenhum repasse ainda" description="Cada repasse registrado aparece aqui." /> : (
            <ul className="divide-y divide-border">
              {payouts.data.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                  <span className="min-w-0 text-sm"><span className="font-medium"><ProfessionalTag nome={o.professionals?.nome ?? "Profissional"} path={o.professionals?.avatar_path} /></span> <span className="text-muted-foreground">· {formatDateTime(o.criado_em, tz)}</span></span>
                  <span className="font-display font-semibold tabular-nums">{formatPrice(o.valor_centavos)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}
