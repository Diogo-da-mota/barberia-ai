import { useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ConfirmDelete } from "@/features/catalog/components/ConfirmDelete"
import { toast } from "@/ui/sonner"
import { cancelBooking, fetchMyBookings } from "../api"
import { RescheduleDialog } from "../components/RescheduleDialog"
import { bookingErrorMessage, canReschedule, formatDateTime, isActive, type BookingRow } from "../domain"

/**
 * Reservas do cliente autenticado (só as que ele fez: `fetchMyBookings` filtra pela conta; a equipe não vê as da barbearia aqui),
 * separadas em próximas e histórico, com cancelar e reagendar.
 * É a ÚNICA lógica de reservas do cliente: o painel (/minhas-reservas) e a área da barbearia (/:slug/minhas-reservas) só mudam a apresentação.
 * `dialogs` traz os pop-ups de confirmação e de reagendamento; quem usa o hook precisa renderizá-lo.
 */
export function useReservations(slug?: string, initialMoveId?: string | null, photos?: Record<string, string | null>): {
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
  const [movingId, setMovingId] = useState(initialMoveId ?? null)

  const bookings = useQuery({ queryKey: ["my-bookings"], queryFn: fetchMyBookings })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["my-bookings"] })

  const cancel = useMutation({
    mutationFn: (b: BookingRow) => cancelBooking(b.id),
    onSuccess: async () => { await refresh(); toast.success("Reserva cancelada."); setCanceling(null) },
    onError: (error) => { toast.error(bookingErrorMessage(error)); setCanceling(null) },
  })
  const now = Date.now()
  const rows = (bookings.data ?? []).filter((b) => !slug || b.barbershops?.slug === slug)
  const upcoming = rows.filter((b) => isActive(b.status) && new Date(b.fim).getTime() >= now).sort((a, b) => a.inicio.localeCompare(b.inicio))
  const history = rows.filter((b) => !upcoming.includes(b)).sort((a, b) => b.inicio.localeCompare(a.inicio))
  const tz = (b: BookingRow) => b.barbershops?.fuso ?? "America/Sao_Paulo"
  const moving = upcoming.find((b) => b.id === movingId && canReschedule(b))

  const dialogs = (
    <>
      <ConfirmDelete
        open={canceling !== null} title="Cancelar esta reserva?" cancelLabel="Manter reserva" confirmLabel="Cancelar reserva"
        description={canceling ? `${canceling.servico_nome}, ${formatDateTime(canceling.inicio, tz(canceling))}. O horário volta a ficar livre para outros clientes.` : ""}
        pending={cancel.isPending} onConfirm={() => canceling && cancel.mutate(canceling)} onClose={() => setCanceling(null)}
      />

      {moving && <RescheduleDialog key={moving.id} booking={moving} tz={tz(moving)} photos={photos} onDone={() => setMovingId(null)} />}
    </>
  )

  return { bookings, rows, upcoming, history, tz, askCancel: setCanceling, askMove: (b) => setMovingId(b.id), dialogs }
}
