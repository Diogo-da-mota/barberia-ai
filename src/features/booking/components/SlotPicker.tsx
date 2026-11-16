import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Calendar } from "@/ui/calendar"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog"
import { ProfessionalChoice } from "./BookingDialog"
import { Skeleton } from "@/ui/skeleton"
import { cn } from "@/lib/utils"
import { getSlotGrid } from "../api"
import { addDays, formatTime, localDate, nearestFree, slotTimes, todayIn, type Slot, type SlotTime } from "../domain"

type SlotPickerProps = {
  shopId: string
  tz: string
  serviceId: string
  /** null = qualquer profissional disponível */
  professionalId: string | null
  selected: string | null
  /** Horário livre escolhido. Pode ser de outro profissional (alternativa a um horário ocupado): quem usa troca o profissional. */
  onSelect: (slot: Slot) => void
  initialDate?: string
  onDateChange?: () => void
  /** Reagendamento: a própria reserva não conta como conflito. */
  bookingId?: string
  /** Todo clique num horário, livre ou ocupado (a reserva pública destaca os profissionais livres no horário ocupado). */
  onPick?: (time: SlotTime) => void
  /** Foto de cada profissional (id → avatar_path) para os cards do pop-up; sem foto, o card mostra a inicial. */
  photos?: Record<string, string | null>
}

/** "AAAA-MM-DD" ↔ Date local (sem deslocamento de fuso no dia). */
const toDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, m - 1, d)
}
const toDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

const HORIZON_DAYS = 60
const CHOICE = "min-h-11 rounded-md border px-3 text-sm font-medium tabular-nums transition-colors md:min-h-10"
const FREE = "aria-pressed:border-primary aria-pressed:bg-primary/10 border-border bg-card hover:bg-surface-alt"
const BUSY = "border-danger/40 bg-danger/10 text-danger line-through decoration-danger/60 hover:bg-danger/15"
const LINK = "rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"

/**
 * Calendário (shadcn) + horários do dia vindos do banco (get_slot_grid). Livre = pode reservar; ocupado (vermelho) = só mostra
 * quem está livre no mesmo horário ou os horários livres mais próximos. Nunca seleciona um horário ocupado do profissional escolhido.
 */
export function SlotPicker({ shopId, tz, serviceId, professionalId, selected, onSelect, initialDate, onDateChange, bookingId, onPick, photos }: SlotPickerProps) {
  const today = todayIn(tz)
  const [date, setDate] = useState(initialDate ?? today)
  const [alternativesAt, setAlternativesAt] = useState<string | null>(null)
  // O calendário acompanha o horário escolhido (ex.: alternativa aceita depois de trocar de dia)
  const [lastSelected, setLastSelected] = useState(selected)
  if (selected !== lastSelected) {
    setLastSelected(selected)
    if (selected && localDate(selected, tz) !== date) setDate(localDate(selected, tz))
  }

  const grid = useQuery({
    queryKey: ["slots", shopId, serviceId, date, bookingId ?? null],
    queryFn: () => getSlotGrid(shopId, serviceId, date, bookingId ?? null),
    // a agenda muda a qualquer momento (outra reserva, painel): sempre consulta de novo ao abrir e ao voltar à aba
    staleTime: 0,
  })

  const times = slotTimes(grid.data ?? [], professionalId, Boolean(bookingId))
  const alternativeTime = times.find((t) => t.inicio === alternativesAt) ?? null
  const canSwitch = bookingId && times.some((t) => t.inicio === selected && t.livre && t.livres.length > 1)
  const nome = (id: string | null) => (grid.data ?? []).find((r) => r.prof_id === id)?.prof_nome
  const pick = (time: SlotTime) => {
    onPick?.(time)
    if (!time.livre) return setAlternativesAt(time.inicio)
    setAlternativesAt(null)
    onSelect(time.livres.find((s) => s.prof_id === professionalId) ?? time.livres[0])
  }
  const alternativas = alternativeTime?.livres ?? []

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      <div className="self-center rounded-card border border-border bg-card md:self-start">
        <Calendar
          mode="single"
          selected={toDate(date)}
          onSelect={(picked) => {
            if (!picked) return
            const day = toDay(picked)
            if (day === date) return
            setDate(day)
            setAlternativesAt(null)
            onDateChange?.()
          }}
          disabled={[{ before: toDate(today) }, { after: toDate(addDays(today, HORIZON_DAYS)) }]}
          defaultMonth={toDate(date)}
          aria-label="Escolha o dia"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm font-medium">Horários em {new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(toDate(date))}</p>
        <div role="group" aria-label="Horários livres">
          {grid.isError ? (
            <p role="alert" className="text-sm text-danger">Não foi possível carregar os horários. Tente outro dia.</p>
          ) : !grid.data ? (
            <div role="status" aria-label="Carregando horários" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-11" />)}
            </div>
          ) : times.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem horários neste dia. Escolha outro dia no calendário.</p>
          ) : (
            <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto overscroll-contain pr-1 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] sm:grid-cols-4">
              {times.map((time) => (
                <button
                  key={time.inicio} type="button"
                  aria-pressed={time.livre ? time.inicio === selected : undefined}
                  aria-label={time.livre ? undefined : `${formatTime(time.inicio, tz)}, ocupado`}
                  className={cn(CHOICE, time.livre ? FREE : BUSY)} onClick={() => pick(time)}
                >
                  {formatTime(time.inicio, tz)}
                </button>
              ))}
            </div>
          )}
        </div>
        {times.some((t) => !t.livre) && <p className="text-xs text-muted-foreground">Em vermelho: ocupado. Toque para ver alternativas.</p>}
        {canSwitch && <button type="button" className={LINK} onClick={() => setAlternativesAt(selected)}>Trocar profissional</button>}

        <Dialog open={alternativeTime !== null} onOpenChange={(open) => !open && setAlternativesAt(null)}>
          <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-[520px] overflow-y-auto bg-card">
            {alternativeTime && (alternativas.length > 0 ? (
              <>
                <div className="flex flex-col gap-1.5 pr-8 text-left">
                  <DialogTitle className="font-display text-xl font-bold tracking-wide">
                    {alternativeTime.livre
                      ? `Profissionais livres às ${formatTime(alternativeTime.inicio, tz)}`
                      : `${nome(professionalId) ?? "Este profissional"} não está disponível às ${formatTime(alternativeTime.inicio, tz)}.`}
                  </DialogTitle>
                  <DialogDescription>Escolha outro profissional disponível nesse horário.</DialogDescription>
                </div>
                <ProfessionalChoice
                  items={alternativas.map((s) => ({ id: s.prof_id, nome: s.prof_nome, avatarPath: photos?.[s.prof_id] ?? null }))}
                  selected={alternativeTime.livre ? professionalId ?? "" : ""}
                  onSelect={(id) => { setAlternativesAt(null); onSelect(alternativas.find((s) => s.prof_id === id)!) }}
                />
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5 pr-8 text-left">
                  <DialogTitle className="font-display text-xl font-bold tracking-wide">Nenhum profissional está livre às {formatTime(alternativeTime.inicio, tz)}.</DialogTitle>
                  <DialogDescription>{nearestFree(times, alternativeTime.inicio).length > 0 ? "Horários livres mais próximos:" : "Escolha outro dia no calendário."}</DialogDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {nearestFree(times, alternativeTime.inicio).map((t) => (
                    <button key={t.inicio} type="button" className={LINK} onClick={() => pick(t)}>{formatTime(t.inicio, tz)}</button>
                  ))}
                </div>
              </>
            ))}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
