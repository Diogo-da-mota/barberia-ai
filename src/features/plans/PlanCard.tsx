import { useQuery } from "@tanstack/react-query"
import { formatDay, isMissingSchema, localDate } from "@/features/booking/domain"
import { Panel, StatusBadge } from "@/ui/finance"
import { fetchPlanUsage } from "./api"
import { planLabel, planStatusLabel, planStatusVariant, usageText } from "./domain"

export function PlanCard({ shopId, tz }: { shopId: string; tz: string }) {
  const usage = useQuery({ queryKey: ["plan-usage", shopId], queryFn: () => fetchPlanUsage(shopId) })
  if (usage.isError) {
    if (isMissingSchema(usage.error)) return null // módulo de planos ainda não aplicado no banco
    return <Panel className="p-4"><p role="alert" className="text-sm text-muted-foreground">Não foi possível carregar o plano.</p></Panel>
  }
  if (!usage.data) return null
  const u = usage.data
  return (
    <Panel className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold">Plano {planLabel(u.plano)}</h2>
        <StatusBadge variant={planStatusVariant(u.status)}>{planStatusLabel(u.status)}</StatusBadge>
      </div>
      <p className="text-sm">{usageText(u.profissionais_ativos, u.max_profissionais)}</p>
      {u.status === "trial" && u.trial_ate && <p className="text-sm text-muted-foreground">Teste até {formatDay(localDate(u.trial_ate, tz), "curto")}.</p>}
      {!u.permite_novos && <p role="alert" className="text-sm text-expense">A assinatura está inativa: novas reservas pela página pública estão bloqueadas.</p>}
      <p className="text-sm text-muted-foreground">A cobrança online ainda não está disponível. Os planos e valores serão definidos antes da primeira cobrança.</p>
    </Panel>
  )
}
