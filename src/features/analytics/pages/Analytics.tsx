import { useMemo, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, CalendarCheck, CalendarDays, Minus, Sparkles, UserCheck, Wallet, type LucideIcon } from "lucide-react"
import { CatalogFrame, ShopGate } from "@/features/catalog/components/CatalogFrame"
import { ProfessionalTag } from "@/features/catalog/components/ProfessionalPhoto"
import { useActiveBarbershop } from "@/features/catalog/hooks/useActiveBarbershop"
import { fetchServices } from "@/features/catalog/api"
import { formatPrice } from "@/features/catalog/domain"
import { fetchShopHours } from "@/features/booking/api"
import { todayIn } from "@/features/booking/domain"
import { Loading, Section, Segmented, StatStrip } from "@/features/finance/components/FinanceUI"
import { dayMonth, daysOf, delta, type Delta } from "@/features/finance/summary"
import type { MyBarbershop } from "@/features/home/domain"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { DateField } from "@/ui/date-time"
import { EmptyState } from "@/ui/finance"
import { fetchAnalytics, fetchCompletedHistory } from "../api"
import { analyzeReturns, MIN_RETURN_CLIENTS } from "../returns"
import {
  bookingsIn, byHour, byProfessional, byService, byWeekday, confirmedRevenue, lastDays, leastWanted, peakHour, previousRange, series, totals, weekdayExtremes,
  MIN_SAMPLE, type Grain, type Range,
} from "../domain"

const NO_DATA = "Sem dados suficientes"
const MAX_DAYS = 366
type Preset = "7" | "30" | "90" | "custom"
const PRESETS: { value: Preset; label: string }[] = [
  { value: "7", label: "7 dias" }, { value: "30", label: "30 dias" }, { value: "90", label: "90 dias" }, { value: "custom", label: "Personalizado" },
]
const GRAINS: { value: Grain; label: string }[] = [{ value: "dia", label: "Dia" }, { value: "semana", label: "Semana" }, { value: "mes", label: "Mês" }]
const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })
const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`

export function Analytics() {
  const gate = useActiveBarbershop()
  return (
    <CatalogFrame title="Análises" description="O desempenho real da barbearia, a partir dos registros do sistema." full>
      <ShopGate gate={gate}>
        {(shop, canManage) => (canManage ? <AnalyticsView shop={shop} /> : <EmptyState title="Análises da gestão" description="Esta tela é do proprietário e do gerente da barbearia." />)}
      </ShopGate>
    </CatalogFrame>
  )
}

function AnalyticsView({ shop }: { shop: MyBarbershop }) {
  const tz = shop.fuso ?? "America/Sao_Paulo"
  const today = todayIn(tz)
  const [preset, setPreset] = useState<Preset>("30")
  const [custom, setCustom] = useState<Range>(() => lastDays(today, 30))
  const [grain, setGrain] = useState<Grain>("dia")
  const range = useMemo(() => (preset === "custom" ? custom : lastDays(today, Number(preset))), [preset, custom, today])
  const previous = useMemo(() => previousRange(range), [range])
  const tooLong = daysOf(range).length > MAX_DAYS

  const data = useQuery({ queryKey: ["analytics", shop.id, previous.de, range.ate], queryFn: () => fetchAnalytics(shop.id, { de: previous.de, ate: range.ate }), enabled: !tooLong })
  const hours = useQuery({ queryKey: ["shop-hours", shop.id], queryFn: () => fetchShopHours(shop.id) })
  const services = useQuery({ queryKey: ["services", shop.id], queryFn: () => fetchServices(shop.id) })

  const view = useMemo(() => {
    if (!data.data || !hours.data || !services.data) return null
    const catalog = services.data.status === "ok" ? services.data.data : []
    const rows = bookingsIn(data.data.bookings, range, tz)
    const now = totals(rows)
    const before = totals(bookingsIn(data.data.bookings, previous, tz))
    const revenue = confirmedRevenue(data.data.payments, data.data.refunds, range, tz)
    const weekdays = byWeekday(rows, range, tz)
    const hourly = byHour(rows, tz)
    const professionals = byProfessional(rows, hours.data, range)
    const serviceStats = byService(rows, revenue, catalog)
    return {
      now, before, revenue: revenue.total, revenueBefore: confirmedRevenue(data.data.payments, data.data.refunds, previous, tz).total,
      weekdays, hourly, professionals,
      extremes: weekdayExtremes(weekdays, new Set(hours.data.map((h) => h.dow))),
      peak: peakHour(hourly),
      services: serviceStats.filter((s) => s.agendados > 0 || s.receita !== 0),
      least: leastWanted(serviceStats, catalog),
      rows,
    }
  }, [data.data, hours.data, services.data, range, previous, tz])

  const setEdge = (edge: keyof Range, value: string) => setCustom((c) => {
    const next = { ...c, [edge]: value }
    return next.de <= next.ate ? next : { de: value, ate: value }
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Período" value={preset} onChange={setPreset} options={PRESETS} />
        {preset === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <DateField aria-label="Início do período" value={custom.de} onChange={(v) => setEdge("de", v)} className="w-40" />
            <span className="text-sm text-muted-foreground">até</span>
            <DateField aria-label="Fim do período" value={custom.ate} onChange={(v) => setEdge("ate", v)} className="w-40" />
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          {dayMonth(range.de)} a {dayMonth(range.ate)} · comparado com {dayMonth(previous.de)} a {dayMonth(previous.ate)}
        </p>
      </div>

      {tooLong ? (
        <EmptyState title="Período longo demais" description="Escolha um período de até 12 meses." />
      ) : data.isError || hours.isError || services.isError ? (
        <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm font-semibold">Não foi possível carregar as análises</p>
          <Button variant="outline" className="h-11 md:h-10" onClick={() => { void data.refetch(); void hours.refetch(); void services.refetch() }}>Tentar novamente</Button>
        </div>
      ) : !view ? (
        <Loading label="Carregando análises" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat icon={CalendarDays} label="Agendamentos" value={num(view.now.agendados)} hint={`${plural(view.now.cancelados, "cancelado", "cancelados")} · ${plural(view.now.faltas, "falta", "faltas")}`} delta={delta(view.now.agendados, view.before.agendados)} />
            <Stat icon={CalendarCheck} label="Atendimentos realizados" value={num(view.now.realizados)} hint={view.now.emAberto > 0 ? `${plural(view.now.emAberto, "agendamento", "agendamentos")} ainda sem desfecho` : "Só os concluídos"} delta={delta(view.now.realizados, view.before.realizados)} lead />
            <Stat icon={UserCheck} label="Comparecimento" value={view.now.comparecimento === null ? NO_DATA : `${view.now.comparecimento}%`} hint="Realizados ÷ (realizados + faltas)" small={view.now.comparecimento === null} />
            <Stat icon={Wallet} label="Receita confirmada" value={formatPrice(view.revenue)} hint="Pagamentos confirmados menos estornos" delta={delta(view.revenue, view.revenueBefore)} />
          </div>

          {view.rows.length === 0 ? (
            <EmptyState title="Nenhum agendamento neste período" description="Escolha outro período para ver as análises." className="rounded-card border border-border bg-card" />
          ) : (
            <>
              <Section title="O que os dados mostram" description="Leitura direta dos registros do período.">
                <Highlights view={view} />
              </Section>

              <Section title="Atendimentos realizados" description="Só reservas concluídas, pela data do atendimento." action={<Segmented label="Agrupar por" value={grain} onChange={setGrain} options={GRAINS} />}>
                <Columns label="Atendimentos realizados" points={series(view.rows, range, tz, grain)} />
              </Section>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Section title="Dias da semana" description="Atendimentos realizados em cada dia da semana.">
                  <Columns label="Atendimentos por dia da semana" points={view.weekdays.map((w) => ({ key: String(w.dow), label: w.label.slice(0, 3), total: w.total }))} />
                </Section>
                <Section title="Horários mais agendados" description="Agendamentos pela hora de início, sem os cancelados.">
                  {view.hourly.length === 0 ? <p className="text-sm text-muted-foreground">{NO_DATA}</p> : <Columns label="Agendamentos por horário" points={view.hourly.map((h) => ({ key: String(h.hora), label: h.label, total: h.total }))} />}
                </Section>
              </div>

              <Section title="Profissionais" description="Ocupação = tempo reservado ÷ jornada cadastrada no período (bloqueios não são descontados).">
                <Table head={["Profissional", "Realizados", "Agendados", "Cancelados", "Faltas", "Serviço mais realizado", "Ocupação"]}>
                  {view.professionals.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <Cell first><ProfessionalTag nome={p.nome} path={p.avatar} /></Cell>
                      <Cell strong><Bar value={p.realizados} max={view.professionals[0]?.realizados ?? 0} /></Cell>
                      <Cell>{num(p.agendados)}</Cell>
                      <Cell>{num(p.cancelados)}</Cell>
                      <Cell>{num(p.faltas)}</Cell>
                      <Cell>{p.topServico ? `${p.topServico.nome} (${num(p.topServico.total)})` : <Muted>{NO_DATA}</Muted>}</Cell>
                      <Cell>{p.ocupacao === null ? <Muted>Sem jornada cadastrada</Muted> : `${p.ocupacao}%`}</Cell>
                    </tr>
                  ))}
                </Table>
              </Section>

              <Section title="Serviços" description="Do mais ao menos agendado. Receita = pagamentos confirmados no período, menos estornos.">
                <Table head={["Serviço", "Agendados", "Realizados", "Receita confirmada"]}>
                  {view.services.map((s) => (
                    <tr key={s.key} className="border-t border-border">
                      <Cell first>{s.nome}</Cell>
                      <Cell strong><Bar value={s.agendados} max={view.services[0]?.agendados ?? 0} /></Cell>
                      <Cell>{num(s.realizados)}</Cell>
                      <Cell>{s.receita === 0 ? <Muted>Sem pagamento confirmado</Muted> : formatPrice(s.receita)}</Cell>
                    </tr>
                  ))}
                </Table>
                {view.least.length > 0 && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Menor procura entre os serviços ativos: <span className="text-foreground">{view.least.map((s) => s.nome).join(", ")}</span> ({plural(view.least[0].agendados, "agendamento", "agendamentos")}).
                  </p>
                )}
              </Section>
            </>
          )}
        </>
      )}

      <ReturnSection shop={shop} today={today} />
    </div>
  )
}

const dateBR = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const days = (n: number) => plural(Math.round(n * 10) / 10, "dia", "dias")
const CLIENT_PREVIEW = 10

/**
 * Frequência de retorno dos clientes. Usa SEMPRE o histórico completo de atendimentos concluídos (não o período do filtro):
 * intervalos entre visitas cortados por um período curto dariam médias erradas e esconderiam quem deixou de vir.
 */
function ReturnSection({ shop, today }: { shop: MyBarbershop; today: string }) {
  const tz = shop.fuso ?? "America/Sao_Paulo"
  const [showAll, setShowAll] = useState(false)
  const history = useQuery({ queryKey: ["analytics-returns", shop.id], queryFn: () => fetchCompletedHistory(shop.id) })
  const services = useQuery({ queryKey: ["services", shop.id], queryFn: () => fetchServices(shop.id) })
  const result = useMemo(() => {
    if (!history.data || !services.data) return null
    return analyzeReturns(history.data, tz, today, services.data.status === "ok" ? services.data.data : [])
  }, [history.data, services.data, tz, today])

  const title = "Frequência de retorno dos clientes"
  if (history.isError || services.isError) {
    return (
      <Section title={title}>
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-sm font-semibold">Não foi possível carregar o histórico de atendimentos</p>
          <Button variant="outline" className="h-11 md:h-10" onClick={() => { void history.refetch(); void services.refetch() }}>Tentar novamente</Button>
        </div>
      </Section>
    )
  }
  if (!result) return <Section title={title}><p role="status" className="text-sm text-muted-foreground">Carregando o histórico de atendimentos…</p></Section>
  if (!result.desde) {
    return <Section title={title} description="Usa o histórico completo de atendimentos concluídos, não o período escolhido acima."><p className="text-sm text-muted-foreground">{NO_DATA}: ainda não há atendimentos concluídos.</p></Section>
  }
  const shown = showAll ? result.clientes : result.clientes.slice(0, CLIENT_PREVIEW)
  return (
    <Section title={title} description={`Histórico completo de atendimentos concluídos, de ${dateBR(result.desde)} até hoje. Não depende do período escolhido acima.`}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <StatStrip items={[
            { label: "Média geral de retorno", value: result.mediaGeral === null ? NO_DATA : `a cada ${days(result.mediaGeral)}` },
            { label: "Clientes recorrentes", value: num(result.recorrentes) },
            { label: "Uma única visita", value: num(result.unicos) },
            { label: "Passaram do intervalo habitual", value: num(result.atrasados), tone: result.atrasados > 0 ? "warning" : undefined },
          ]} />
          <p className="text-xs text-muted-foreground">
            {result.mediaGeral === null
              ? `A média precisa de pelo menos ${MIN_RETURN_CLIENTS} clientes com mais de uma visita (há ${num(result.recorrentes)}).`
              : `Média das médias individuais de ${plural(result.recorrentes, "cliente", "clientes")} com mais de uma visita.`} Visitas no mesmo dia contam como uma.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="font-display text-sm font-bold tracking-wide">Retorno por serviço</h3>
            <p className="text-xs text-muted-foreground">Intervalo entre atendimentos do mesmo serviço, do retorno mais frequente ao menos frequente.</p>
            <Table head={["Serviço", "Retorno médio", "Clientes na média"]} narrow>
              {result.servicos.map((s) => (
                <tr key={s.key} className="border-t border-border">
                  <Cell first>{s.nome}</Cell>
                  <Cell strong={s.media !== null}>{s.media === null ? <Muted>{NO_DATA}</Muted> : `a cada ${days(s.media)}`}</Cell>
                  <Cell>{num(s.clientes)}</Cell>
                </tr>
              ))}
            </Table>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="font-display text-sm font-bold tracking-wide">Clientes recorrentes</h3>
            <p className="text-xs text-muted-foreground">Quem mais passou do próprio intervalo habitual aparece primeiro.</p>
            {result.clientes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{NO_DATA}: nenhum cliente com mais de uma visita.</p>
            ) : (
              <>
                <Table head={["Cliente", "Visitas", "Retorna a cada", "Última visita", "Sem vir há"]}>
                  {shown.map((c) => (
                    <tr key={c.key} className="border-t border-border">
                      <Cell first>{c.nome}</Cell>
                      <Cell>{num(c.visitas)}</Cell>
                      <Cell>{days(c.media!)}</Cell>
                      <Cell>{dateBR(c.ultimo)}</Cell>
                      <Cell strong={c.atrasado}><span className={cn(c.atrasado && "text-warning")}>{days(c.diasDesde)}</span>{c.atrasado && <span className="sr-only"> (passou do intervalo habitual)</span>}</Cell>
                    </tr>
                  ))}
                </Table>
                {result.clientes.length > CLIENT_PREVIEW && (
                  <Button variant="outline" className="h-11 self-start md:h-10" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Mostrar menos" : `Mostrar todos (${num(result.clientes.length)})`}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Section>
  )
}

type View = {
  now: ReturnType<typeof totals>
  extremes: ReturnType<typeof weekdayExtremes>
  peak: ReturnType<typeof peakHour>
  professionals: ReturnType<typeof byProfessional>
  services: ReturnType<typeof byService>
  least: ReturnType<typeof leastWanted>
}

/** Frases montadas só com números do período; cada uma some quando não há amostra para sustentá-la. */
function Highlights({ view }: { view: View }) {
  const { now, extremes, peak, professionals, services } = view
  const items: ReactNode[] = []
  if (extremes) {
    items.push(<><b>{extremes.best.label}</b> é o dia mais movimentado: média de {plural(extremes.best.media, "atendimento", "atendimentos")} por dia.</>)
    if (extremes.worst) items.push(<><b>{extremes.worst.label}</b> é o dia mais fraco entre os que a barbearia abre: média de {num(extremes.worst.media)}.</>)
  }
  if (peak) items.push(<>O horário mais procurado é o das <b>{peak.label}</b>: {plural(peak.total, "agendamento", "agendamentos")}.</>)
  const topPro = professionals[0]
  if (topPro && professionals.length > 1 && now.realizados >= MIN_SAMPLE) {
    items.push(<><b>{topPro.nome}</b> realizou mais atendimentos: {num(topPro.realizados)} ({Math.round((topPro.realizados / now.realizados) * 100)}% do total).</>)
  }
  const topService = services[0]
  if (topService && now.agendados >= MIN_SAMPLE) items.push(<><b>{topService.nome}</b> é o serviço mais agendado: {num(topService.agendados)}.</>)
  const lost = now.cancelados + now.faltas
  if (lost > 0 && now.agendados >= MIN_SAMPLE) {
    items.push(<>{plural(now.cancelados, "cancelamento", "cancelamentos")} e {plural(now.faltas, "falta", "faltas")}: <b>{Math.round((lost / now.agendados) * 100)}%</b> dos agendamentos não viraram atendimento.</>)
  }
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{NO_DATA}: são necessários pelo menos {MIN_SAMPLE} registros no período.</p>
  return (
    <ul className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm lg:grid-cols-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2"><span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /><span>{item}</span></li>
      ))}
    </ul>
  )
}

function Stat({ icon: Icon, label, value, hint, delta: change, lead, small }: { icon: LucideIcon; label: string; value: string; hint: string; delta?: Delta; lead?: boolean; small?: boolean }) {
  const Arrow = change?.direction === "up" ? ArrowUp : change?.direction === "down" ? ArrowDown : change?.direction === "new" ? Sparkles : Minus
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 rounded-card border p-4", lead ? "border-primary/25 bg-primary/[0.06]" : "border-border bg-card")}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"><Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{label}</span></p>
        {change && (
          <span title="Comparado com o período anterior" className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums", change.direction === "up" && "bg-income/15 text-income", change.direction === "down" && "bg-expense/15 text-expense", (change.direction === "flat" || change.direction === "new") && "bg-surface-alt text-muted-foreground")}>
            <Arrow aria-hidden="true" className="h-3 w-3" />{change.text}<span className="sr-only"> sobre o período anterior</span>
          </span>
        )}
      </div>
      <p className={cn("font-display font-bold leading-none tabular-nums", small ? "text-base" : "text-2xl")}>{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

/** Colunas de contagem (valores reais, sem biblioteca de gráficos). O número aparece sobre a coluna quando há espaço. */
function Columns({ label, points }: { label: string; points: { key: string; label: string; total: number }[] }) {
  const max = Math.max(0, ...points.map((p) => p.total))
  const total = points.reduce((t, p) => t + p.total, 0)
  const every = Math.ceil(points.length / 10)
  const showValues = points.length <= 16
  if (total === 0) return <p className="text-sm text-muted-foreground">{NO_DATA}</p>
  return (
    <div role="img" aria-label={`${label}. Total ${num(total)}. ${points.filter((p) => p.total > 0).map((p) => `${p.label}: ${p.total}`).join(", ")}.`} className="flex flex-col gap-2">
      <div className="flex h-44 items-end gap-[3px] border-b border-border sm:gap-1.5">
        {points.map((p) => (
          <div key={p.key} title={`${p.label} · ${num(p.total)}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            {showValues && p.total > 0 && <span className="text-[11px] font-semibold tabular-nums">{p.total}</span>}
            <span className={cn("w-full max-w-10 rounded-t-md bg-gradient-to-t from-primary/50 to-primary", p.total === max && "from-primary/70")} style={{ height: p.total > 0 ? `${Math.max((p.total / max) * 82, 2)}%` : 0 }} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="flex gap-[3px] text-[11px] tabular-nums text-muted-foreground sm:gap-1.5">
        {points.map((p, i) => <span key={p.key} className="relative min-w-0 flex-1">{i % every === 0 && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{p.label}</span>}&nbsp;</span>)}
      </div>
    </div>
  )
}

function Table({ head, children, narrow }: { head: string[]; children: ReactNode; narrow?: boolean }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className={cn("w-full text-left text-sm", narrow ? "min-w-[360px]" : "min-w-[640px]")}>
        <thead>
          <tr>{head.map((h, i) => <th key={h} scope="col" className={cn("pb-2 text-xs font-medium text-muted-foreground", i > 0 && "pl-4")}>{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Cell({ children, first, strong }: { children: ReactNode; first?: boolean; strong?: boolean }) {
  return <td className={cn("py-2.5 align-middle tabular-nums", !first && "pl-4", first && "max-w-[220px] font-medium", strong && "font-semibold")}>{children}</td>
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-muted-foreground">{children}</span>

/** Número com uma barra proporcional ao maior da coluna. */
function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="w-8 shrink-0">{num(value)}</span>
      <span aria-hidden="true" className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-alt"><span className="block h-full rounded-full bg-primary" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} /></span>
    </span>
  )
}
