import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog"
import { toast } from "@/ui/sonner"
import { rescheduleBooking } from "../api"
import { bookingErrorMessage, formatDateTime, localDate, type BookingRow, type Slot } from "../domain"
import { SlotPicker } from "./SlotPicker"

type Props = {
  booking: Pick<BookingRow, "id" | "barbershop_id" | "inicio" | "service_id" | "servico_nome" | "professional_id">
  tz: string
  photos?: Record<string, string | null>
  onDone: () => void | Promise<unknown>
}

type Selection = Slot & { requestId: string }

export function RescheduleForm({ booking, tz, photos, onDone }: Props) {
  const queryClient = useQueryClient()
  const [selection, setSelection] = useState<Selection | null>(null)
  const [professionalId, setProfessionalId] = useState(booking.professional_id)
  const move = useMutation({
    mutationFn: (slot: Selection) => rescheduleBooking(booking.id, slot.slot_inicio, slot.prof_id, slot.requestId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["slots", booking.barbershop_id] }),
        queryClient.invalidateQueries({ queryKey: ["my-bookings"] }),
        queryClient.invalidateQueries({ queryKey: ["shop-bookings", booking.barbershop_id] }),
      ])
      toast.success("Reserva reagendada.")
      await onDone()
    },
    onError: (error) => {
      if (error?.message === "slot_taken") void queryClient.invalidateQueries({ queryKey: ["slots", booking.barbershop_id] })
    },
  })
  const unchanged = selection && selection.prof_id === booking.professional_id && Date.parse(selection.slot_inicio) === Date.parse(booking.inicio)
  const confirmLabel = selection && selection.prof_id !== booking.professional_id ? `Confirmar com ${selection.prof_nome}` : "Confirmar novo horário"

  if (!booking.service_id) return null

  return (
    <fieldset disabled={move.isPending} className="flex min-w-0 flex-col gap-3">
      <SlotPicker shopId={booking.barbershop_id} tz={tz} serviceId={booking.service_id} professionalId={professionalId}
        bookingId={booking.id} initialDate={localDate(booking.inicio, tz)} photos={photos} selected={selection?.slot_inicio ?? null}
        onDateChange={() => { setSelection(null); move.reset() }}
        onSelect={(slot) => {
          const requestId = crypto.randomUUID()
          setProfessionalId(slot.prof_id)
          setSelection((current) => current?.prof_id === slot.prof_id && current.slot_inicio === slot.slot_inicio
            ? current : { ...slot, requestId })
          move.reset()
        }} />
      {move.isError && <p role="alert" className="text-sm text-danger">{bookingErrorMessage(move.error)}</p>}
      <Button className="h-11 w-full md:h-10" disabled={!selection || Boolean(unchanged)} onClick={() => selection && move.mutate(selection)}>
        {move.isPending ? "Reagendando…" : confirmLabel}
      </Button>
    </fieldset>
  )
}

export function RescheduleDialog({ booking, tz, photos, onDone }: Props) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDone() }}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-[560px] overflow-y-auto bg-card">
        <div className="flex flex-col gap-1.5 pr-8 text-left">
          <DialogTitle className="font-display text-2xl font-bold tracking-wide">Reagendar</DialogTitle>
          <DialogDescription>{booking.servico_nome} · {formatDateTime(booking.inicio, tz)}. A reserva atual vale até a confirmação do novo horário.</DialogDescription>
        </div>
        <RescheduleForm booking={booking} tz={tz} photos={photos} onDone={onDone} />
      </DialogContent>
    </Dialog>
  )
}
