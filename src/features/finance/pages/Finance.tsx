import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CatalogFrame, ShopGate } from "@/features/catalog/components/CatalogFrame"
import { useActiveBarbershop } from "@/features/catalog/hooks/useActiveBarbershop"
import { formatPrice } from "@/features/catalog/domain"
import type { MyBarbershop } from "@/features/home/domain"
import { Tabs, TabsContent } from "@/ui/tabs"
import { CommissionList, CommissionsTab } from "../components/CommissionsTab"
import { usePathTab } from "@/lib/pathTab"
import { FINANCE_TABS, FinanceHeader } from "../components/FinanceHeader"
import { PayoutsTab } from "../components/PayoutsTab"
import { ExpensesTab } from "../components/ExpensesTab"
import { Loading, Metric, QueryError, Section } from "../components/FinanceUI"
import { PaymentsTab } from "../components/PaymentsTab"
import { SummaryTab } from "../components/SummaryTab"
import { fetchCommissions, fetchPayouts } from "../api"
import { monthRange, rangeOfMonth } from "../domain"

export function Finance() {
  const gate = useActiveBarbershop()
  const manager = gate.state === "ready" && gate.canManage
  const tz = (gate.state === "ready" ? gate.active?.fuso : null) ?? "America/Sao_Paulo"
  const [tab, setTab] = usePathTab("/financeiro", FINANCE_TAB_IDS)
  const [pickedMonth, setMonth] = useState<string | null>(null)
  const month = pickedMonth ?? monthRange(new Date(), tz).de.slice(0, 7)
  // A aba e o mês moram aqui porque as abas ficam no cabeçalho, acima do conteúdo.
  return (
    <Tabs value={tab} onValueChange={setTab} className="contents">
      <CatalogFrame title="Financeiro" description="Controle de pagamentos, comissões, repasses e despesas da barbearia." full header={<FinanceHeader tabs={manager} showMonth={MONTH_TABS.has(tab)} month={month} onMonth={setMonth} />}>
        <ShopGate gate={gate}>{(shop, canManage) => (canManage ? <ManagerView shop={shop} month={month} /> : <MyEarnings shop={shop} />)}</ShopGate>
      </CatalogFrame>
    </Tabs>
  )
}

const FINANCE_TAB_IDS = FINANCE_TABS.map((t) => t.value)

// ---------- Barbeiro: só os próprios ganhos (o RLS já filtra) ----------

function MyEarnings({ shop }: { shop: MyBarbershop }) {
  const commissions = useQuery({ queryKey: ["commissions", shop.id], queryFn: () => fetchCommissions(shop.id) })
  const payouts = useQuery({ queryKey: ["payouts", shop.id], queryFn: () => fetchPayouts(shop.id) })
  if (commissions.isError) return <QueryError error={commissions.error} onRetry={() => void commissions.refetch()} />
  if (!commissions.data || !payouts.data) return <Loading label="Carregando seus ganhos" />
  const sum = (status: string) => commissions.data.filter((c) => c.status === status).reduce((t, c) => t + c.valor_centavos, 0)
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-lg font-bold">Meus ganhos</h2>
      <div className="grid grid-cols-2 gap-3 md:max-w-xl">
        <Metric label="A receber" value={sum("provisionada")} />
        <Metric label="Já repassado" value={sum("liquidada")} tone="income" />
      </div>
      <Section title="Minhas comissões" description={`${payouts.data.length} ${payouts.data.length === 1 ? "repasse recebido" : "repasses recebidos"} (${formatPrice(payouts.data.reduce((t, p) => t + p.valor_centavos, 0))}).`}>
        <CommissionList items={commissions.data} tz={shop.fuso ?? "America/Sao_Paulo"} />
      </Section>
    </div>
  )
}

// ---------- Gestão ----------

/** Só Resumo e Despesas dependem do mês; Pagamentos, Comissões e Repasses mostram o acumulado recente. */
const MONTH_TABS = new Set(["resumo", "despesas"])

function ManagerView({ shop, month }: { shop: MyBarbershop; month: string }) {
  const tz = shop.fuso ?? "America/Sao_Paulo"
  const range = useMemo(() => rangeOfMonth(month) ?? monthRange(new Date(), tz), [month, tz])
  return (
    <>
      <TabsContent value="resumo"><SummaryTab shop={shop} range={range} /></TabsContent>
      <TabsContent value="pagamentos"><PaymentsTab shop={shop} /></TabsContent>
      <TabsContent value="comissoes"><CommissionsTab shop={shop} /></TabsContent>
      <TabsContent value="repasses"><PayoutsTab shop={shop} /></TabsContent>
      <TabsContent value="despesas"><ExpensesTab shop={shop} range={range} /></TabsContent>
    </>
  )
}
