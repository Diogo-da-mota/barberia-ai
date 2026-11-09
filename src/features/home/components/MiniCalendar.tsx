import { useMemo } from "react"
import { Calendar } from "@/ui/calendar"
import { isActive, localDate, type BookingRow } from "@/features/booking/domain"

const toDate = (day: string) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
const toDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/**
 * Calendário do mês: um ponto nos dias com atendimento (dados reais) e clique no dia para ver os atendimentos dele.
 * Clicar no dia já escolhido volta para "próximos atendimentos".
 */
export function MiniCalendar({ rows, tz, selected, onSelect }: { rows: BookingRow[]; tz: string; selected: string | null; onSelect: (day: string | null) => void }) {
  const booked = useMemo(() => {
    const days = new Set(rows.filter((b) => isActive(b.status) || b.status === "concluido").map((b) => localDate(b.inicio, tz)))
    return [...days].map(toDate)
  }, [rows, tz])
  return (
    <section aria-label="Calendário" className="overflow-hidden rounded-card border border-border bg-card p-2 shadow-sm sm:p-3">
      <Calendar
        mode="single"
        weekStartsOn={1}
        selected={selected ? toDate(selected) : undefined}
        defaultMonth={selected ? toDate(selected) : undefined}
        onSelect={(d) => onSelect(d ? toDay(d) : null)}
        modifiers={{ booked }}
        modifiersClassNames={{ booked: "[&>button]:relative [&>button]:after:absolute [&>button]:after:bottom-1 [&>button]:after:left-1/2 [&>button]:after:h-1 [&>button]:after:w-1 [&>button]:after:-translate-x-1/2 [&>button]:after:rounded-full [&>button]:after:bg-primary" }}
        classNames={{
          root: "relative w-full",
          month_grid: "w-full",
          weekdays: "flex justify-between",
          weekday: "w-9 pb-1 text-center text-[13px] font-medium capitalize text-muted-foreground",
          week: "mt-1 flex w-full justify-between",
          day: "relative p-0 text-center text-sm",
          day_button: "h-9 w-9 rounded-md text-sm font-medium tabular-nums transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          today: "[&>button]:bg-primary/25 [&>button]:font-bold",
          selected: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:after:bg-primary-foreground",
        }}
      />
    </section>
  )
}
