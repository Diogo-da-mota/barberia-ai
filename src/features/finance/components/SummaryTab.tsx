import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, CalendarDays, Layers, Receipt, Tag, Trophy, TrendingUp, Users } from "lucide-react"
import { formatPrice } from "@/features/catalog/domain"
import type { MyBarbershop } from "@/features/home/domain"
import { formatTime, localDate } from "@/features/booking/domain"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { EmptyState, StatusBadge } from "@/ui/finance"
import { Skeleton } from "@/ui/skeleton"
import { fetchExpenses, fetchPaymentsWindow, fetchPayouts, fetchRefundsWindow, fetchReport } from "../api"
import { paymentFormLabel, pendingTotal, rangeOfMonth } from "../domain"
import { MOVEMENT_LABEL, MIN_TICKET_SAMPLE, averageTicket, buildMovements, confirmedIn, dailySeries, dayMonth, delta, previousMonth, refundsIn, revenueByService, sumByKey, utcWindow } from "../summary"
import { BarChart, Donut, KpiCard, Loading, QueryError, Section, Segmented, Signed } from "./FinanceUI"

type Range = { de: string; ate: string }
type Mode = "receita" | "custo"

function SectionSkeleton({ label }: { label: string }) {
  return <div role="status" aria-label={label}><Skeleton className="h-40 w-full" /></div>
}

function SectionFailed({ onRetry }: { onRetry: () => void }) {
  return <EmptyState title="Não foi possível carregar esta seção" description="Os indicadores acima não dependem dela." action={<button type="button" className="text-sm font-semibold text-primary underline underline-offset-4" onClick={onRetry}>Tentar novamente</button>} />
}

const STATUS_VARIANT = { Confirmado: "income", "A confirmar": "warning", Estornado: "expense", Repassado: "default", Lançado: "default" } as const
const KIND_VARIANT = { recebimento: "income", estorno: "expense", repasse: "default", custo: "expense" } as const

/** Cartão lateral de um indicador complementar: ícone, rótulo, valor e uma linha de apoio real. */
function SideStat({ icon: Icon, label, value, hint }: { icon: typeof Trophy; label: string; value: string; hint: string }) {
  return (
    <div className="flex min-w-0 items-center gap-4 rounded-card border border-border bg-card p-4">
      <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"><Icon className="h-5 w-5" /></span>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="truncate font-display text-xl font-bold leading-tight tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}

export function SummaryTab({ shop, range }: { shop: MyBarbershop; range: Range }) {
  const tz = shop.fuso ?? "America/Sao_Paulo"
  const win = useMemo(() => utcWindow(range), [range])
  const prevRange = useMemo(() => rangeOfMonth(previousMonth(range.de.slice(0, 7))), [range])
  const [mode, setMode] = useState<Mode>("receita")
  const [allMovements, setAllMovements] = useState(false)
  const report = useQuery({ queryKey: ["finance-report", shop.id, range.de, range.ate], queryFn: () => fetchReport(shop.id, range.de, range.ate) })
  const previous = useQuery({ queryKey: ["finance-report", shop.id, prevRange?.de, prevRange?.ate], queryFn: () => fetchReport(shop.id, prevRange!.de, prevRange!.ate), enabled: prevRange !== null })
  const payments = useQuery({ queryKey: ["payments-window", shop.id, range.de, range.ate], queryFn: () => fetchPaymentsWindow(shop.id, win.from, win.to) })
  const refunds = useQuery({ queryKey: ["refunds-window", shop.id, range.de, range.ate], queryFn: () => fetchRefundsWindow(shop.id, win.from, win.to) })
  const expenses = useQuery({ queryKey: ["expenses", shop.id, range.de, range.ate], queryFn: () => fetchExpenses(shop.id, range.de, range.ate) })
  const payouts = useQuery({ queryKey: ["payouts", shop.id], queryFn: () => fetchPayouts(shop.id) })

  const derived = useMemo(() => {
    if (!payments.data || !refunds.data || !expenses.data) return null
    const confirmed = confirmedIn(payments.data, range, tz)
    const refunded = refundsIn(refunds.data, range, tz)
    const refundedTotal = refunded.reduce((t, r) => t + r.valor_centavos, 0)
    const received = confirmed.reduce((t, p) => t + p.valor_centavos, 0) - refundedTotal
    const bookingsPaid = new Set(confirmed.map((p) => p.booking_id)).size
    const pending = pendingTotal(payments.data.filter((p) => p.confirmado_em === null && localDate(p.criado_em, tz) >= range.de && localDate(p.criado_em, tz) <= range.ate))
    const receitas = sumByKey(confirmed.map((p) => ({ key: paymentFormLabel(p.forma), cents: p.valor_centavos })))
    const despesas = sumByKey(expenses.data.map((e) => ({ key: e.categoria, cents: e.valor_centavos })))
    return {
      days: dailySeries(range, tz, payments.data, refunds.data, expenses.data),
      receitas, despesas, refundedTotal,
      receitasTotal: receitas.reduce((t, i) => t + i.cents, 0),
      despesasTotal: despesas.reduce((t, i) => t + i.cents, 0),
      topService: revenueByService(confirmed)[0] ?? null,
      ticket: averageTicket(received, bookingsPaid),
      bookingsPaid, pending,
      movements: payouts.data ? buildMovements({ tz, range, payments: payments.data, refunds: refunds.data, payouts: payouts.data, expenses: expenses.data }) : null,
    }
  }, [payments.data, refunds.data, expenses.data, payouts.data, range, tz])

  if (report.isError) return <QueryError error={report.error} onRetry={() => void report.refetch()} />
  if (!report.data) return <Loading label="Carregando resumo" />
  const r = report.data
  const p = previous.data
  const retry = () => { void payments.refetch(); void refunds.refetch(); void expenses.refetch() }
  const failed = payments.isError || refunds.isError || expenses.isError
  const hasFlow = derived ? derived.days.some((d) => d.receita !== 0 || d.custo !== 0) : false
  const donutItems = derived ? (mode === "receita" ? derived.receitas : derived.despesas) : []
  const movements = derived?.movements ?? []
  const shownMovements = allMovements ? movements : movements.slice(0, 5)
  const dayLabel = (iso: string) => dayMonth(localDate(iso, tz))

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={TrendingUp} tone="primary" label="Receita (recebido)" value={r.recebido_centavos} delta={p ? delta(r.recebido_centavos, p.recebido_centavos) : null} />
        <KpiCard icon={CalendarDays} tone="neutral" label="Previsto (agendamentos)" value={r.previsto_centavos} delta={p ? delta(r.previsto_centavos, p.previsto_centavos) : null} />
        <KpiCard icon={Tag} tone="expense" label="Custos" value={r.custos_centavos} delta={p ? delta(r.custos_centavos, p.custos_centavos) : null} lowerIsBetter />
        <KpiCard icon={Layers} tone="primary" label="Resultado estimado" value={r.resultado_estimado_centavos} valueTone={r.resultado_estimado_centavos < 0 ? "expense" : undefined} delta={p ? delta(r.resultado_estimado_centavos, p.resultado_estimado_centavos) : null} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Section
          title={mode === "receita" ? "Evolução da receita" : "Evolução dos custos"}
          description="Receita já sem estornos; custos pela data do lançamento."
          action={<Segmented<Mode> label="Série do gráfico" value={mode} onChange={setMode} options={[{ value: "receita", label: "Receita" }, { value: "custo", label: "Custos" }]} />}
        >
          {failed ? <SectionFailed onRetry={retry} /> : !derived ? <SectionSkeleton label="Carregando evolução" /> : hasFlow ? <BarChart days={derived.days} series={mode} /> : (
            <EmptyState title="Sem movimentação neste mês" description="Quando houver pagamentos confirmados ou custos lançados, a evolução aparece aqui." />
          )}
        </Section>

        <Section title={mode === "receita" ? "Origem da receita" : "Origem dos custos"} description={mode === "receita" ? "Pagamentos confirmados por forma de pagamento. Comissões e repasses não são receita." : "Custos lançados por categoria."}>
          {failed ? <SectionFailed onRetry={retry} /> : !derived ? <SectionSkeleton label="Carregando origem" /> : donutItems.length === 0 ? (
            <div className="flex flex-col items-center gap-3">
              <Donut items={[]} tone={mode === "receita" ? "primary" : "expense"} center={formatPrice(0)} centerLabel={mode === "receita" ? "Confirmado" : "Custos"} />
              <p className="text-sm text-muted-foreground">{mode === "receita" ? "Nenhum pagamento confirmado neste mês." : "Nenhum custo lançado neste mês."}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Donut items={donutItems} tone={mode === "receita" ? "primary" : "expense"} center={formatPrice(mode === "receita" ? derived.receitasTotal : derived.despesasTotal)} centerLabel={mode === "receita" ? "Confirmado" : "Custos"} />
              {mode === "receita" && derived.refundedTotal > 0 && <p className="flex justify-between gap-3 border-t border-border pt-3 text-sm"><span className="text-muted-foreground">Estornos do mês</span><Signed cents={-derived.refundedTotal} /></p>}
            </div>
          )}
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <Section
          title="Últimas movimentações"
          action={movements.length > 5 ? (
            <Button variant="outline" className="h-10 gap-2" aria-expanded={allMovements} onClick={() => setAllMovements((v) => !v)}>
              {allMovements ? "Ver menos" : "Ver todas"}<ArrowRight aria-hidden="true" className={cn("h-4 w-4 transition-transform", allMovements && "-rotate-90")} />
            </Button>
          ) : undefined}
        >
          {failed || payouts.isError ? <SectionFailed onRetry={() => { retry(); void payouts.refetch() }} /> : !derived?.movements ? <SectionSkeleton label="Carregando movimentações" /> : movements.length === 0 ? (
            <EmptyState title="Nenhuma movimentação" description="Os lançamentos do mês aparecem aqui, do mais recente para o mais antigo." />
          ) : (
            <div>
              <div aria-hidden="true" className="hidden grid-cols-[150px_minmax(0,1fr)_110px_120px_110px] gap-x-4 border-b border-border pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground md:grid">
                <span>Data</span><span>Descrição</span><span>Tipo</span><span className="text-right">Valor</span><span className="text-right">Status</span>
              </div>
              <ul className="divide-y divide-border">
                {shownMovements.map((m) => (
                  <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3 md:grid-cols-[150px_minmax(0,1fr)_110px_120px_110px]">
                    <span className="hidden items-center gap-2 text-sm md:flex"><CalendarDays aria-hidden="true" className="h-4 w-4 text-muted-foreground" />{m.kind === "custo" ? dayLabel(m.at) : `${dayLabel(m.at)}, ${formatTime(m.at, tz)}`}</span>
                    <span className="min-w-0 truncate text-sm font-medium">{m.descricao}</span>
                    <span className="hidden md:block"><StatusBadge variant={KIND_VARIANT[m.kind]}>{MOVEMENT_LABEL[m.kind]}</StatusBadge></span>
                    <Signed cents={m.cents} className="row-span-2 text-right text-sm md:row-span-1" />
                    <span className="hidden md:block md:text-right"><StatusBadge variant={STATUS_VARIANT[m.status]}>{m.status}</StatusBadge></span>
                    <span className="text-xs text-muted-foreground md:hidden">{dayLabel(m.at)} · {MOVEMENT_LABEL[m.kind]} · {m.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <div className="flex min-w-0 flex-col gap-3">
          {!derived ? <SectionSkeleton label="Carregando indicadores" /> : (
            <>
              <SideStat icon={Trophy} label="Serviço de maior receita" value={derived.topService?.key ?? "—"} hint={derived.topService ? `${formatPrice(derived.topService.cents)} confirmados no período` : "Sem pagamentos confirmados no período"} />
              <SideStat icon={Receipt} label="Ticket médio realizado" value={derived.ticket === null ? "—" : formatPrice(derived.ticket)} hint={derived.ticket === null ? `Precisa de ${MIN_TICKET_SAMPLE} atendimentos pagos no mês (há ${derived.bookingsPaid})` : `Valor médio por atendimento (${derived.bookingsPaid} pagos)`} />
              <SideStat icon={Users} label="Comissões a repassar" value={formatPrice(r.comissoes_provisionadas_centavos)} hint={`Já repassadas: ${formatPrice(r.comissoes_liquidadas_centavos)}`} />
            </>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Um pagamento só soma em Recebido depois que você o confirma. Eles são declarados pela barbearia (PIX, dinheiro, débito, crédito); ainda não há integração com maquininha ou banco, então nada aqui é conciliação bancária.
        {derived && derived.pending > 0 && <> Declarado e a confirmar neste mês: <strong className="tabular-nums">{formatPrice(derived.pending)}</strong>.</>}
      </p>
    </div>
  )
}
