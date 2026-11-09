import { useState } from "react"
import { Shell } from "@/app/Shell"
import { formatDay, localDate, type BookingRow } from "@/features/booking/domain"
import type { MyBarbershopsResult } from "../api"
import { formatToday } from "../domain"
import { AgendaBoard } from "./AgendaBoard"
import { BarbershopList } from "./BarbershopList"
import { MiniCalendar } from "./MiniCalendar"
import { QuickActions } from "./QuickActions"
import { StatCards } from "./StatCards"

export type HomeViewProps = {
  name: string | null
  result: MyBarbershopsResult | undefined
  isError: boolean
  isRetrying: boolean
  onRetry: () => void
  customerOnly: boolean
  isManager: boolean
  siteSlug: string | null
  tz: string
  rows: BookingRow[] | undefined
  allBookings: BookingRow[]
  stats: { today: number; week: number; attendance: number | null } | null
  occupancy: number | null
  received: number | null | undefined
  /** Logo da barbearia (de Meu site) para o cartão "Sua barbearia". */
  logoUrl?: string | null
}

/** Tela inicial (visual): só recebe dados prontos. Os dados reais e as permissões são resolvidos em `Home`. */
export function HomeView(p: HomeViewProps) {
  const [day, setDay] = useState<string | null>(null)
  const dayRows = day
    ? p.allBookings.filter((b) => b.status !== "cancelado" && localDate(b.inicio, p.tz) === day).sort((a, b) => a.inicio.localeCompare(b.inicio))
    : undefined
  const shopCard = <BarbershopList compact logoUrl={p.logoUrl} result={p.result} isError={p.isError} isRetrying={p.isRetrying} onRetry={p.onRetry} />
  return (
    <Shell hero="/images/painel-topo.jpg">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-4">
        <header className="flex min-h-32 flex-col justify-center gap-1.5 pt-2 pb-3 sm:min-h-40">
          <h1 className="font-display text-4xl leading-none font-bold tracking-wide sm:text-5xl">
            {p.name ? `Olá, ${p.name}` : "Olá"}
          </h1>
          <p className="text-base text-muted-foreground sm:text-lg">{formatToday(new Date())}</p>
        </header>

        {p.result && !p.customerOnly ? (
          <StatCards stats={p.stats} occupancy={p.occupancy} received={p.received}>{shopCard}</StatCards>
        ) : (
          shopCard
        )}
        {p.result && !p.customerOnly && <QuickActions manager={p.isManager} siteSlug={p.siteSlug} />}

        <div className={p.customerOnly ? "" : "grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]"}>
          <AgendaBoard
            customerOnly={p.customerOnly} rows={p.result ? (dayRows ?? p.rows) : []} tz={p.tz}
            day={day ? { label: formatDay(day, "curto"), onClear: () => setDay(null) } : undefined}
          />
          {p.result && !p.customerOnly && <MiniCalendar rows={p.allBookings} tz={p.tz} selected={day} onSelect={setDay} />}
        </div>
      </div>
    </Shell>
  )
}
