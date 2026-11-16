import { Link } from "react-router-dom"
import { CatalogFrame } from "@/features/catalog/components/CatalogFrame"
import { formatDuration, formatPrice } from "@/features/catalog/domain"
import { Button } from "@/ui/button"
import { EmptyState, Panel, StatusBadge } from "@/ui/finance"
import { Skeleton } from "@/ui/skeleton"
import { useReservations } from "../hooks/useReservations"
import { CompleteWhatsApp } from "../components/CompleteWhatsApp"
import { ReservationCard } from "../components/ReservationCard"
import { canReschedule, formatDateTime, isMissingSchema, STATUS_LABEL, type BookingRow, type BookingStatus } from "../domain"
import { shopPath } from "@/lib/shopPaths"

const BADGE: Record<BookingStatus, "income" | "warning" | "danger" | "default"> = {
  pendente: "warning", confirmado: "income", concluido: "default", cancelado: "danger", nao_compareceu: "danger",
}

/** Tela do Shell: reservas do cliente em todas as barbearias. */
export function MyBookings() {
  return (
    <CatalogFrame title="Minhas reservas" description="Próximas reservas, histórico, cancelamentos e reagendamentos.">
      <MyBookingsView />
    </CatalogFrame>
  )
}

/** Conteúdo das reservas do cliente; com `slug`, só as daquela barbearia. A lógica é a de `useReservations`; aqui só a apresentação do painel. */
export function MyBookingsView({ slug }: { slug?: string }) {
  const { bookings, rows, upcoming, history, tz, askCancel, askMove, dialogs } = useReservations(slug)

  const card = (b: BookingRow, actions: boolean) => (
    <ReservationCard
      key={b.id}
      professional={b.professionals ?? { nome: b.servico_nome }}
      actions={actions && (
        <>
          {canReschedule(b) && <Button variant="outline" className="h-11 whitespace-nowrap md:h-10" onClick={() => askMove(b)}>Reagendar</Button>}
          <Button variant="outline" className="h-11 whitespace-nowrap md:h-10" onClick={() => askCancel(b)}>Cancelar reserva</Button>
        </>
      )}
    >
      <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
        {b.servico_nome}
        <StatusBadge variant={BADGE[b.status]}>{STATUS_LABEL[b.status]}</StatusBadge>
      </p>
      <p className="text-sm">{formatDateTime(b.inicio, tz(b))}</p>
      <p className="text-sm text-muted-foreground tabular-nums">
        {[b.barbershops?.nome, b.professionals?.nome, formatDuration(b.duracao_min), formatPrice(b.preco_centavos)].filter(Boolean).join(" · ")}
      </p>
    </ReservationCard>
  )

  return (
    <>
      <div className="flex flex-col gap-6">
        <CompleteWhatsApp />
        {isMissingSchema(bookings.error) ? (
          <Panel><EmptyState title="Reservas indisponíveis" description="O agendamento ainda está sendo preparado no banco de dados." /></Panel>
        ) : bookings.isError ? (
          <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm font-semibold">Não foi possível carregar suas reservas</p>
            <Button variant="outline" className="h-11" onClick={() => void bookings.refetch()}>Tentar novamente</Button>
          </div>
        ) : !bookings.data ? (
          <div role="status" aria-label="Carregando reservas" className="flex flex-col gap-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
        ) : rows.length === 0 ? (
          <Panel>
            <EmptyState title="Você ainda não tem reservas" description="Escolha um serviço na página da barbearia para agendar um horário." action={<Button asChild className="h-11"><Link to={slug ? shopPath(slug) : "/"}>{slug ? "Agendar um horário" : "Voltar ao início"}</Link></Button>} />
          </Panel>
        ) : (
          <>
            <section aria-labelledby="proximas" className="flex flex-col gap-3">
              <h2 id="proximas" className="font-display text-xl font-semibold tracking-wide">Próximas</h2>
              {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma reserva ativa.</p> : <ul className="flex flex-col gap-3">{upcoming.map((b) => card(b, true))}</ul>}
            </section>
            {history.length > 0 && (
              <section aria-labelledby="historico" className="flex flex-col gap-3">
                <h2 id="historico" className="font-display text-xl font-semibold tracking-wide">Histórico</h2>
                <ul className="flex flex-col gap-3">{history.map((b) => card(b, false))}</ul>
              </section>
            )}
          </>
        )}
      </div>
      {dialogs}
    </>
  )
}
