import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Calendar } from "@/ui/calendar"
import { Skeleton } from "@/ui/skeleton"
import { cn } from "@/lib/utils"
import { getAvailability } from "../api"
import { addDays, formatTime, todayIn, type Slot } from "../domain"

type SlotPickerProps = {
  shopId: string
  tz: string
  serviceId: string
  /** null = qualquer profissional disponível */
  professionalId: string | null
  selected: string | null
  onSelect: (slot: Slot) => void
  initialDate?: string
}

/** "AAAA-MM-DD" ↔ Date local (sem deslocamento de fuso no dia). */
const toDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, m - 1, d)
}
const toDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

const HORIZON_DAYS = 60
const CHOICE =
  "min-h-11 rounded-md border px-3 text-sm font-medium tabular-nums transition-colors md:min-h-10 aria-pressed:border-primary aria-pressed:bg-primary/10 border-border bg-card hover:bg-surface-alt"

/** Calendário (shadcn) + horários livres do dia, vindos do banco (get_availability). */
export function SlotPicker({ shopId, tz, serviceId, professionalId, selected, onSelect, initialDate }: SlotPickerProps) {
  const today = todayIn(tz)
  const [date, setDate] = useState(initialDate ?? today)

  const slots = useQuery({
    queryKey: ["slots", shopId, serviceId, professionalId, date],
    queryFn: () => getAvailability(shopId, serviceId, professionalId, date),
  })

  // Com "qualquer profissional", cada horário aparece uma vez
  const unique = [...new Map((slots.data ?? []).map((slot) => [slot.slot_inicio, slot])).values()]

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      <div className="self-center rounded-card border border-border bg-card md:self-start">
        <Calendar
          mode="single"
          selected={toDate(date)}
          onSelect={(picked) => picked && setDate(toDay(picked))}
          disabled={[{ before: toDate(today) }, { after: toDate(addDays(today, HORIZON_DAYS)) }]}
          defaultMonth={toDate(date)}
          aria-label="Escolha o dia"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm font-medium">Horários livres em {new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(toDate(date))}</p>
        <div role="group" aria-label="Horários livres">
          {slots.isError ? (
            <p role="alert" className="text-sm text-danger">Não foi possível carregar os horários. Tente outro dia.</p>
          ) : !slots.data ? (
            <div role="status" aria-label="Carregando horários" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-11" />)}
            </div>
          ) : unique.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem horários livres neste dia. Escolha outro dia no calendário.</p>
          ) : (
            <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto overscroll-contain pr-1 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] sm:grid-cols-4">
              {unique.map((slot) => (
                <button
                  key={slot.slot_inicio} type="button" aria-pressed={slot.slot_inicio === selected}
                  className={cn(CHOICE)} onClick={() => onSelect(slot)}
                >
                  {formatTime(slot.slot_inicio, tz)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
