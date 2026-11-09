import type { ReactNode } from "react"
import { formatPrice } from "@/features/catalog/domain"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { EmptyState } from "@/ui/finance"
import { Skeleton } from "@/ui/skeleton"
import { isMissingSchema } from "@/features/booking/domain"
import { ArrowDown, ArrowUp, Minus, Sparkles, type LucideIcon } from "lucide-react"
import { dayMonth, niceScale, type DayPoint, type Delta, type Share } from "../summary"

export const FIELD = "h-11 text-base md:h-10 md:text-sm"

export type Tone = "income" | "expense" | "warning"
const TONE: Record<Tone, string> = { income: "text-income", expense: "text-expense", warning: "text-warning" }

/** Cartão do painel: borda fina, título à esquerda e ação opcional à direita. O destaque vem do token `primary`. */
export function Section({ title, description, action, children, className, id }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  const headingId = id ?? `sec-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  return (
    <section aria-labelledby={headingId} className={cn("flex min-w-0 flex-col rounded-card border border-border bg-card", className)}>
      <header className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <h2 id={headingId} className="font-display text-base font-bold tracking-wide">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </header>
      <div className="flex min-w-0 flex-1 flex-col px-4 pb-4 pt-3 sm:px-5 sm:pb-5">{children}</div>
    </section>
  )
}

/** Indicador do resumo: rótulo, valor em destaque e, quando existir, uma linha de apoio real. */
export function Metric({ label, value, tone, hint, lead }: { label: string; value: number; tone?: Tone; hint?: string; lead?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 rounded-card border bg-card p-4 transition-colors", lead ? "border-primary/40 bg-primary/[0.06]" : "border-border hover:border-foreground/20")}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn("truncate font-display text-[22px] font-bold leading-none tabular-nums", tone && TONE[tone])}>{formatPrice(value)}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Faixa única com vários números lado a lado (abas Pagamentos, Comissões e Custos): evita uma parede de cartões iguais. */
export function StatStrip({ items }: { items: { label: string; value: string; tone?: Tone }[] }) {
  return (
    <dl className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-card border border-border bg-card sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))] sm:divide-y-0 [&>div:nth-child(odd):last-child]:col-span-2 sm:[&>div:nth-child(odd):last-child]:col-span-1">
      {items.map((i) => (
        <div key={i.label} className="flex min-w-0 flex-col gap-1 px-4 py-3">
          <dt className="text-sm text-muted-foreground">{i.label}</dt>
          <dd className={cn("truncate font-display text-lg font-bold tabular-nums", i.tone && TONE[i.tone])}>{i.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Loading({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 w-full rounded-card" />)}</div>
      <Skeleton className="h-56 w-full rounded-card" />
    </div>
  )
}

export function QueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (isMissingSchema(error)) return <EmptyState title="Financeiro indisponível" description="O módulo financeiro ainda está sendo preparado no banco de dados." />
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
      <p className="text-sm font-semibold">Não foi possível carregar os dados financeiros</p>
      <Button variant="outline" className="h-11 md:h-10" onClick={onRetry}>Tentar novamente</Button>
    </div>
  )
}

/** Valor com sinal e cor semântica: entrada verde, saída vermelha, independentes da cor de destaque. */
export function Signed({ cents, className }: { cents: number; className?: string }) {
  return <span className={cn("font-display font-semibold tabular-nums", cents < 0 ? "text-expense" : "text-income", className)}>{cents > 0 ? "+" : cents < 0 ? "−" : ""}{formatPrice(Math.abs(cents))}</span>
}

/** Barras horizontais proporcionais (origem das receitas, despesas por categoria). */
export function ShareBars({ items, tone }: { items: Share[]; tone: "primary" | "expense" }) {
  const total = items.reduce((t, i) => t + i.cents, 0)
  return (
    <ul className="flex flex-col gap-3">
      {items.map((i) => {
        const pct = total > 0 ? (i.cents / total) * 100 : 0
        return (
          <li key={i.key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{i.key}</span>
              <span className="shrink-0 tabular-nums"><span className="font-semibold">{formatPrice(i.cents)}</span> <span className="text-muted-foreground">· {Math.round(pct)}%</span></span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-alt" aria-hidden="true">
              <div className={cn("h-full rounded-full transition-[width] duration-300", tone === "primary" ? "bg-primary" : "bg-expense/80")} style={{ width: `${Math.max(pct, 2)}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const KPI_TONE = {
  primary: { card: "border-primary/25 bg-primary/[0.06]", tile: "bg-primary/15 text-primary" },
  neutral: { card: "border-border bg-card", tile: "bg-surface-alt text-foreground" },
  expense: { card: "border-expense/25 bg-expense/[0.06]", tile: "bg-expense/15 text-expense" },
} as const

/** Indicador do topo do Resumo: ícone, rótulo, valor e a variação sobre o mês anterior (só quando existe base real). */
export function KpiCard({ icon: Icon, label, value, tone, valueTone, delta, lowerIsBetter }: {
  icon: LucideIcon; label: string; value: number; tone: keyof typeof KPI_TONE; valueTone?: Tone; delta?: Delta | null; lowerIsBetter?: boolean
}) {
  const good = delta && (delta.direction === "flat" || delta.direction === "new" ? null : (delta.direction === "up") !== Boolean(lowerIsBetter))
  const Arrow = delta?.direction === "up" ? ArrowUp : delta?.direction === "down" ? ArrowDown : delta?.direction === "new" ? Sparkles : Minus
  return (
    <div className={cn("flex min-w-0 items-center gap-3 rounded-card border p-3.5", KPI_TONE[tone].card)}>
      <span aria-hidden="true" className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", KPI_TONE[tone].tile)}><Icon className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-tight text-muted-foreground">{label}</p>
        <p className={cn("whitespace-nowrap font-display text-xl font-bold leading-tight tabular-nums", valueTone && TONE[valueTone])}>{formatPrice(value)}</p>
      </div>
      {delta && (
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums", good === true && "bg-income/15 text-income", good === false && "bg-expense/15 text-expense", good === null && "bg-surface-alt text-muted-foreground")}>
            <Arrow aria-hidden="true" className="h-3 w-3" />{delta.text}
          </span>
          <span className="text-[10px] leading-none text-muted-foreground">vs. mês anterior</span>
        </div>
      )}
    </div>
  )
}

/** Alternância de duas opções (Receita | Custos), no mesmo estilo das abas. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-md border border-border bg-surface-alt p-1">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={cn("min-h-9 rounded px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{o.label}</button>
      ))}
    </div>
  )
}

const reais = (cents: number) => `R$ ${(cents / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`

/** Barras por dia de UMA série (receita ou custos), com eixo em reais e datas a cada 4 dias. Valores reais, sem biblioteca de gráficos. */
export function BarChart({ days, series }: { days: DayPoint[]; series: "receita" | "custo" }) {
  const values = days.map((d) => Math.max(0, series === "receita" ? d.receita : d.custo))
  const { top, ticks } = niceScale(Math.max(0, ...values))
  const total = days.reduce((t, d) => t + (series === "receita" ? d.receita : d.custo), 0)
  const label = series === "receita" ? "Receita" : "Custos"
  return (
    <div role="img" aria-label={`${label} por dia. Total ${formatPrice(total)}.`} className="grid flex-1 grid-cols-[3.75rem_minmax(0,1fr)] grid-rows-[minmax(10rem,1fr)_auto] gap-x-3">
      <div aria-hidden="true" className="relative">
        {ticks.map((t, i) => <span key={t} className="absolute right-0 translate-y-1/2 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground" style={{ bottom: `${(i / (ticks.length - 1)) * 100}%` }}>{reais(t)}</span>)}
      </div>
      <div className="relative">
        {ticks.map((t, i) => <span key={t} aria-hidden="true" className={cn("absolute inset-x-0 border-t", i === 0 ? "border-border" : "border-dashed border-border/60")} style={{ bottom: `${(i / (ticks.length - 1)) * 100}%` }} />)}
        <div className="relative flex h-full items-end gap-[3px] sm:gap-1.5">
          {days.map((d, i) => (
            <div key={d.date} title={`${dayMonth(d.date)} · ${formatPrice(values[i])}`} className="flex h-full min-w-0 flex-1 items-end justify-center">
              <span className={cn("w-full max-w-9 rounded-t-md bg-gradient-to-t transition-opacity hover:opacity-80", series === "receita" ? "from-primary/50 to-primary" : "from-expense/50 to-expense")} style={{ height: values[i] > 0 ? `${Math.max((values[i] / top) * 100, 1.5)}%` : "0%", minHeight: values[i] > 0 ? 3 : 0 }} />
            </div>
          ))}
        </div>
      </div>
      <span aria-hidden="true" />
      <div aria-hidden="true" className="relative mt-2 flex gap-[3px] text-[11px] tabular-nums text-muted-foreground sm:gap-1.5">
        {days.map((d, i) => <span key={d.date} className="relative min-w-0 flex-1">{i % 4 === 0 && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{dayMonth(d.date)}</span>}&nbsp;</span>)}
      </div>
    </div>
  )
}

const SHADES = [1, 0.7, 0.45, 0.28, 0.16]

/** Rosca de proporções com total no centro e legenda ao lado. Cores: o destaque (receitas) ou o vermelho de custo, em tons. */
export function Donut({ items, tone, center, centerLabel }: { items: Share[]; tone: "primary" | "expense"; center: string; centerLabel: string }) {
  const total = items.reduce((t, i) => t + i.cents, 0)
  const R = 62, C = 2 * Math.PI * R
  let offset = 0
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-5">
      <div className="relative h-40 w-40 shrink-0">
        <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="80" cy="80" r={R} fill="none" strokeWidth="16" className="stroke-surface-alt" />
          {total > 0 && items.map((it, i) => {
            const len = (it.cents / total) * C
            const el = <circle key={it.key} cx="80" cy="80" r={R} fill="none" strokeWidth="16" strokeLinecap="butt" strokeDasharray={`${Math.max(len - 2, 0)} ${C}`} strokeDashoffset={-offset} opacity={SHADES[Math.min(i, SHADES.length - 1)]} className={tone === "primary" ? "stroke-primary" : "stroke-expense"} />
            offset += len
            return el
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-display text-lg font-bold tabular-nums">{center}</span>
          <span className="text-sm text-muted-foreground">{centerLabel}</span>
        </div>
      </div>
      <ul className="flex w-full min-w-0 flex-1 flex-col gap-3">
        {items.map((it, i) => (
          <li key={it.key} className="flex items-center gap-3 text-sm">
            <span aria-hidden="true" className={cn("h-3 w-3 shrink-0 rounded-full", tone === "primary" ? "bg-primary" : "bg-expense")} style={{ opacity: SHADES[Math.min(i, SHADES.length - 1)] }} />
            <span className="min-w-0 flex-1 truncate">{it.key}</span>
            <span className="font-semibold tabular-nums">{formatPrice(it.cents)}</span>
            <span className="w-10 text-right tabular-nums text-muted-foreground">{total > 0 ? Math.round((it.cents / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
