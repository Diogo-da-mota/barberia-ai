import { useId } from "react"
import { CalendarCheck, CalendarRange, Gauge, Wallet } from "lucide-react"
import { formatPrice } from "@/features/catalog/domain"
import { cn } from "@/lib/utils"

type Stats = { today: number; week: number; attendance: number | null } | null

/**
 * Indicadores da tela inicial, todos calculados de dados reais (reservas e relatório financeiro).
 * Sem dados, mostra "—" em vez de um número inventado. `received` só chega para a gestão.
 */
export function StatCards({ stats, occupancy, received, children }: { stats: Stats; occupancy: number | null; received: number | null | undefined; children?: React.ReactNode }) {
  const titleId = useId()
  const card = "flex min-w-0 items-center gap-3 rounded-card border bg-card p-3.5 shadow-sm"
  const icon = "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-alt text-primary"
  const value = "font-display text-[28px] leading-8 font-bold tabular-nums"
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className="sr-only">Indicadores</h2>
      <div className={cn("grid gap-3 sm:grid-cols-2", children ? "xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(250px,1.15fr)]" : received !== undefined ? "xl:grid-cols-4" : "lg:grid-cols-3")}>
        <div className={cn(card, "border-primary/70 bg-primary/10")}>
          <span className={cn(icon, "bg-primary/15")}><CalendarCheck className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="text-sm text-foreground/80">Atendimentos hoje</p>
            <p className={value}>{stats ? stats.today : "—"}</p>
          </div>
        </div>
        <div className={cn(card, "border-border")}>
          <span className={icon}><CalendarRange className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Próximos 7 dias</p>
            <p className={value}>{stats ? stats.week : "—"}</p>
          </div>
        </div>
        {received !== undefined && (
          <div className={cn(card, "border-border")}>
            <span className={icon}><Wallet className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">Recebido (mês)</p>
              <p className={cn(value, "truncate")}>{received === null ? "—" : formatPrice(received)}</p>
            </div>
          </div>
        )}
        <div className={cn(card, "flex-col items-stretch gap-2 border-border")}>
          <div className="flex items-center gap-4">
            <span className={icon}><Gauge className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{occupancy != null ? "Ocupação (7 dias)" : "Comparecimento (30 dias)"}</p>
              <p className={value}>{occupancy != null ? `${occupancy}%` : stats?.attendance != null ? `${stats.attendance}%` : "—"}</p>
            </div>
          </div>
          {occupancy != null && (
            <>
              <div role="presentation" className="h-2 overflow-hidden rounded-full bg-surface-alt"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, occupancy)}%` }} /></div>
              {stats?.attendance != null && <p className="text-xs text-muted-foreground">Comparecimento (30 dias): {stats.attendance}%</p>}
            </>
          )}
        </div>
        {children}
      </div>
    </section>
  )
}
