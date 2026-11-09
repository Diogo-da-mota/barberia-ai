import { useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ConfirmDelete } from "@/features/catalog/components/ConfirmDelete"
import { Button } from "@/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog"
import { toast } from "@/ui/sonner"
import { cancelBooking, fetchMyBookings, rescheduleBooking } from "../api"
import { SlotPicker } from "../components/SlotPicker"
import { bookingErrorMessage, formatDateTime, isActive, type BookingRow, type Slot } from "../domain"

/**
 * Reservas do cliente autenticado (só as dele: a regra está no banco), separadas em próximas e histórico, com cancelar e reagendar.
 * É a ÚNICA lógica de reservas do cliente: o painel (/minhas-reservas) e a área da barbearia (/:slug/minhas-reservas) só mudam a apresentação.
 * `dialogs` traz os pop-ups de confirmação e de reagendamento; quem usa o hook precisa renderizá-lo.
 */
export function useReservations(slug?: string): {
  bookings: ReturnType<typeof useQuery<BookingRow[]>>
  rows: BookingRow[]
  upcoming: BookingRow[]
  history: BookingRow[]
  tz: (b: BookingRow) => string
  askCancel: (b: BookingRow) => void
  askMove: (b: BookingRow) => void
  dialogs: ReactNode
} {
  const queryClient = useQueryClient()
  const [canceling, setCanceling] = useState<BookingRow | null>(null)
  const [moving, setMoving] = useState<BookingRow | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)

  const bookings = useQuery({ queryKey: ["my-bookings"], queryFn: fetchMyBookings })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["my-bookings"] })

  const cancel = useMutation({
    mutationFn: (b: BookingRow) => cancelBooking(b.id),
    onSuccess: async () => { await refresh(); toast.success("Reserva cancelada."); setCanceling(null) },
    onError: (error) => { toast.error(bookingErrorMessage(error)); setCanceling(null) },
  })
  const move = useMutation({
    mutationFn: (b: BookingRow) => rescheduleBooking(b.id, slot!.slot_inicio, b.professional_id),
    onSuccess: async () => { await refresh(); await queryClient.invalidateQueries({ queryKey: ["slots"] }); toast.success("Reserva reagendada."); setMoving(null); setSlot(null) },
    onError: (error) => toast.error(bookingErrorMessage(error)),
  })

  const now = Date.now()
  const rows = (bookings.data ?? []).filter((b) => !slug || b.barbershops?.slug === slug)
  const upcoming = rows.filter((b) => isActive(b.status) && new Date(b.fim).getTime() >= now).sort((a, b) => a.inicio.localeCompare(b.inicio))
  const history = rows.filter((b) => !upcoming.includes(b)).sort((a, b) => b.inicio.localeCompare(a.inicio))
  const tz = (b: BookingRow) => b.barbershops?.fuso ?? "America/Sao_Paulo"

  const dialogs = (
    <>
      <ConfirmDelete
        open={canceling !== null} title="Cancelar esta reserva?" cancelLabel="Manter reserva" confirmLabel="Cancelar reserva"
        description={canceling ? `${canceling.servico_nome}, ${formatDateTime(canceling.inicio, tz(canceling))}. O horário volta a ficar livre para outros clientes.` : ""}
        pending={cancel.isPending} onConfirm={() => canceling && cancel.mutate(canceling)} onClose={() => setCanceling(null)}
      />

      <Dialog open={moving !== null} onOpenChange={(open) => !open && setMoving(null)}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-[560px] overflow-y-auto bg-card">
          <div className="flex flex-col gap-1.5 pr-8 text-left">
            <DialogTitle className="font-display text-2xl font-bold tracking-wide">Reagendar</DialogTitle>
            <DialogDescription>Escolha o novo horário com o mesmo profissional. Se ele estiver ocupado, sua reserva atual continua valendo.</DialogDescription>
          </div>
          {moving?.service_id && (
            <SlotPicker shopId={moving.barbershop_id} tz={tz(moving)} serviceId={moving.service_id} professionalId={moving.professional_id} selected={slot?.slot_inicio ?? null} onSelect={setSlot} />
          )}
          <Button className="h-11 w-full md:h-10" disabled={!slot || move.isPending} onClick={() => moving && move.mutate(moving)}>
            {move.isPending ? "Reagendando…" : "Confirmar novo horário"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )

  return { bookings, rows, upcoming, history, tz, askCancel: setCanceling, askMove: (b) => { setMoving(b); setSlot(null) }, dialogs }
}
