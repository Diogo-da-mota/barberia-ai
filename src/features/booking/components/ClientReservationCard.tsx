import type { ReactNode } from "react"
import { Ban, CalendarDays, Check, Clock, Coins, Hourglass, UserRound, Scissors, type LucideIcon } from "lucide-react"
import { formatDuration, formatPrice } from "@/features/catalog/domain"
import { cn } from "@/lib/utils"
import { formatDay, formatTime, localDate, STATUS_LABEL, type BookingRow, type BookingStatus } from "../domain"

const STATUS: Record<BookingStatus, { icon: LucideIcon; className: string }> = {
  pendente: { icon: Clock, className: "border-warning/40 bg-warning/10 text-warning" },
  confirmado: { icon: Check, className: "border-income/40 bg-income/10 text-income" },
  concluido: { icon: Check, className: "border-border bg-surface-alt text-muted-foreground" },
  cancelado: { icon: Ban, className: "border-expense/40 bg-expense/10 text-expense" },
  nao_compareceu: { icon: Ban, className: "border-expense/40 bg-expense/10 text-expense" },
}

function Meta({ icon: Icon, children, label }: { icon: LucideIcon; children: ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 lg:px-3 lg:first:pl-0">
      <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
      <div className="min-w-0 leading-tight"><span className="sr-only">{label}: </span><span className="text-sm">{children}</span></div>
    </div>
  )
}

/**
 * Card de reserva da área do cliente da barbearia: foto do serviço (a cadastrada pela barbearia; sem foto, um quadro discreto),
 * nome e status reais, data, horário, profissional, duração e valor, e as ações só quando a reserva permite (`actions`).
 */
export function ClientReservationCard({ booking, tz, photo, actions }: { booking: BookingRow; tz: string; photo?: string | null; actions?: ReactNode }) {
  const status = STATUS[booking.status]
  const StatusIcon = status.icon
  const day = formatDay(localDate(booking.inicio, tz))
  const [weekday, date] = day.includes(",") ? [day.slice(0, day.indexOf(",")), day.slice(day.indexOf(",") + 2)] : ["", day]
  return (
    <li className={cn("flex flex-col overflow-hidden rounded-2xl border border-border bg-card/80 text-left sm:min-h-36 sm:flex-row", booking.status === "cancelado" && "bg-card/50")}>
      <div className="relative h-36 shrink-0 bg-surface-alt sm:h-auto sm:w-44 lg:w-48">
        {photo ? <img src={photo} alt="" loading="lazy" className={cn("absolute inset-0 h-full w-full object-cover", booking.status === "cancelado" && "opacity-60 grayscale")} /> : (
          <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/20 via-primary/5 to-surface-alt text-primary/70"><Scissors className="h-9 w-9" /></div>
        )}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-card/70 via-transparent to-transparent sm:bg-gradient-to-r sm:from-transparent sm:via-transparent sm:to-card/80" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-display text-2xl leading-none font-bold tracking-wide">{booking.servico_nome}</h3>
            <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium", status.className)}>
              <StatusIcon aria-hidden="true" className="h-3.5 w-3.5" />{STATUS_LABEL[booking.status]}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-5 sm:gap-y-3 lg:gap-x-0 lg:divide-x lg:divide-border">
            <Meta icon={CalendarDays} label="Data">{weekday && <span className="block text-muted-foreground">{weekday},</span>}<span className="block font-semibold">{date}</span></Meta>
            <Meta icon={Clock} label="Horário"><span className="font-semibold tabular-nums">{formatTime(booking.inicio, tz)}</span></Meta>
            <Meta icon={UserRound} label="Profissional">{booking.professionals?.nome ?? "—"}</Meta>
            <Meta icon={Hourglass} label="Duração"><span className="tabular-nums">{formatDuration(booking.duracao_min)}</span></Meta>
            <Meta icon={Coins} label="Valor"><span className="font-semibold tabular-nums">{formatPrice(booking.preco_centavos)}</span></Meta>
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-row gap-2 sm:w-44 sm:flex-col">{actions}</div>}
      </div>
    </li>
  )
}
