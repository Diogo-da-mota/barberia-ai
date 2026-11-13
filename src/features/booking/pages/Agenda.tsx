import { useState, type FormEvent } from "react"
import { formatPhone } from "@/lib/br"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarPlus, ChevronLeft, ChevronRight, Lock } from "lucide-react"
import { fetchProfessionals } from "@/features/catalog/api"
import { CatalogFrame, ShopGate } from "@/features/catalog/components/CatalogFrame"
import { ConfirmDelete } from "@/features/catalog/components/ConfirmDelete"
import { formatDuration, formatPrice, type Professional } from "@/features/catalog/domain"
import { useActiveBarbershop } from "@/features/catalog/hooks/useActiveBarbershop"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog"
import { EmptyState, Field, Panel, StatusBadge } from "@/ui/finance"
import { DateTimeField } from "@/ui/date-time"
import { Input } from "@/ui/input"
import { Skeleton } from "@/ui/skeleton"
import { toast } from "@/ui/sonner"
import { ManualBookingDialog } from "../components/ManualBookingDialog"
import { ReservationCard } from "../components/ReservationCard"
import { cancelBooking, createBlock, deleteBlock, fetchBlocks, fetchShopBookings, setBookingStatus } from "../api"
import {
  addDays, addMonths, bookingErrorMessage, formatDay, formatMonth, formatTime, isActive, isMissingSchema, localDate, monthGrid, parseRange,
  STATUS_LABEL, todayIn, weekStart, zonedToUtc, type BookingRow, type BookingStatus,
} from "../domain"

const BADGE: Record<BookingStatus, "income" | "warning" | "danger" | "default"> = {
  pendente: "warning", confirmado: "income", concluido: "default", cancelado: "danger", nao_compareceu: "danger",
}

type View = "dia" | "semana" | "mes"
const VIEWS: { id: View; label: string }[] = [{ id: "dia", label: "Dia" }, { id: "semana", label: "Semana" }, { id: "mes", label: "Mês" }]

export function Agenda() {
  const gate = useActiveBarbershop()
  return (
    <CatalogFrame title="Agendamentos" description="Atendimentos por horário." banner="agenda">
      <ShopGate gate={gate}>
        {(shop, canManage) =>
          canManage || shop.papel === "barbeiro" ? (
            <DayAgenda shopId={shop.id} tz={shop.fuso ?? "America/Sao_Paulo"} readOnly={!canManage} />
          ) : (
            <EmptyState title="Agenda restrita" description="Somente a equipe vê a agenda." />
          )
        }
      </ShopGate>
    </CatalogFrame>
  )
}

type Row =
  | { kind: "booking"; inicio: string; fim: string; booking: BookingRow }
  | { kind: "block"; inicio: string; fim: string; id: string; professionalId: string; motivo: string | null }

/** readOnly = barbeiro: vê só a própria agenda e apenas conclui ou marca falta. */
function DayAgenda({ shopId, tz, readOnly }: { shopId: string; tz: string; readOnly: boolean }) {
  const queryClient = useQueryClient()
  const [date, setDate] = useState(() => todayIn(tz))
  const [view, setView] = useState<View>("dia")
  const [canceling, setCanceling] = useState<BookingRow | null>(null)
  const [blocking, setBlocking] = useState(false)
  const [scheduling, setScheduling] = useState(false)

  const bookings = useQuery({ queryKey: ["shop-bookings", shopId], queryFn: () => fetchShopBookings(shopId) })
  const blocks = useQuery({ queryKey: ["blocks", shopId], queryFn: () => fetchBlocks(shopId) })
  const team = useQuery({ queryKey: ["professionals", shopId], queryFn: () => fetchProfessionals(shopId) })
  const professionals: Professional[] = team.data?.status === "ok" ? team.data.data : []
  const nameOf = (id: string) => professionals.find((p) => p.id === id)?.nome ?? "Profissional"

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["shop-bookings", shopId] }),
    queryClient.invalidateQueries({ queryKey: ["blocks", shopId] }),
    queryClient.invalidateQueries({ queryKey: ["slots"] }),
  ])
  const fail = (error: unknown) => toast.error(bookingErrorMessage(error))

  const status = useMutation({
    mutationFn: ({ id, to }: { id: string; to: "concluido" | "nao_compareceu" }) => setBookingStatus(id, to),
    onSuccess: async () => { await refresh(); toast.success("Status atualizado.") },
    onError: fail,
  })
  const cancel = useMutation({
    mutationFn: (b: BookingRow) => cancelBooking(b.id),
    onSuccess: async () => { await refresh(); toast.success("Reserva cancelada."); setCanceling(null) },
    onError: (e) => { fail(e); setCanceling(null) },
  })
  const unblock = useMutation({
    mutationFn: (id: string) => deleteBlock(id),
    onSuccess: async () => { await refresh(); toast.success("Bloqueio removido.") },
    onError: fail,
  })

  if (isMissingSchema(bookings.error) || isMissingSchema(blocks.error)) {
    return <EmptyState title="Agenda indisponível" description="A agenda ainda está sendo preparada no banco de dados." />
  }
  if (bookings.isError || blocks.isError) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm font-semibold">Não foi possível carregar a agenda</p>
        <Button variant="outline" className="h-11 md:h-10" onClick={() => { void bookings.refetch(); void blocks.refetch() }}>Tentar novamente</Button>
      </div>
    )
  }

  const allRows: Row[] = [
    ...(bookings.data ?? []).filter((b) => b.status !== "cancelado").map((b): Row => ({ kind: "booking", inicio: b.inicio, fim: b.fim, booking: b })),
    ...(blocks.data ?? []).flatMap((b): Row[] => {
      const { inicio, fim } = parseRange(b.periodo)
      return [{ kind: "block", inicio, fim, id: b.id, professionalId: b.professional_id, motivo: b.motivo }]
    }),
  ].sort((a, b) => a.inicio.localeCompare(b.inicio))
  const rowsOf = (day: string) => allRows.filter((row) => localDate(row.inicio, tz) === day)

  const step = (n: number) => setDate(view === "mes" ? addMonths(date, n) : addDays(date, n * (view === "semana" ? 7 : 1)))
  const monday = weekStart(date)
  const title = view === "dia" ? formatDay(date) : view === "semana" ? `${formatDay(monday, "curto")} a ${formatDay(addDays(monday, 6), "curto")}` : formatMonth(date)
  const unit = view === "dia" ? "dia" : view === "semana" ? "semana" : "mês"
  const count = (day: string) => rowsOf(day).length

  const renderRow = (row: Row) =>
    row.kind === "block" ? (
      <ReservationCard
        key={row.id} muted
        photo={<div aria-hidden="true" className="flex aspect-square w-full items-center justify-center bg-primary/10 text-primary"><Lock className="h-8 w-8" /></div>}
        actions={!readOnly && <Button variant="outline" className="h-11 whitespace-nowrap md:h-10" onClick={() => unblock.mutate(row.id)} aria-label={`Remover bloqueio das ${formatTime(row.inicio, tz)}`}>Remover</Button>}
      >
        <p className="text-base font-semibold tabular-nums">{formatTime(row.inicio, tz)} – {formatTime(row.fim, tz)}</p>
        <p className="text-sm text-muted-foreground">Bloqueado · {nameOf(row.professionalId)}{row.motivo ? ` · ${row.motivo}` : ""}</p>
      </ReservationCard>
    ) : (
      <ReservationCard
        key={row.booking.id}
        professional={row.booking.professionals ?? { nome: row.booking.cliente_nome }}
        actions={isActive(row.booking.status) && (
          <>
            {row.booking.status === "confirmado" && new Date(row.booking.inicio) <= new Date() && (
              <>
                <Button className="h-11 whitespace-nowrap md:h-10" disabled={status.isPending} onClick={() => status.mutate({ id: row.booking.id, to: "concluido" })}>Concluir</Button>
                <Button variant="outline" className="h-11 whitespace-nowrap md:h-10" disabled={status.isPending} onClick={() => status.mutate({ id: row.booking.id, to: "nao_compareceu" })}>Faltou</Button>
              </>
            )}
            {!readOnly && <Button variant="outline" className="h-11 whitespace-nowrap md:h-10" aria-label={`Cancelar reserva de ${row.booking.cliente_nome}`} onClick={() => setCanceling(row.booking)}>Cancelar</Button>}
          </>
        )}
      >
        <p className="flex flex-wrap items-center gap-2 text-base font-semibold">{row.booking.servico_nome}<StatusBadge variant={BADGE[row.booking.status]}>{STATUS_LABEL[row.booking.status]}</StatusBadge></p>
        <p className="text-sm font-medium tabular-nums">{formatTime(row.inicio, tz)} – {formatTime(row.fim, tz)}</p>
        <p className="text-sm text-muted-foreground">
          {[row.booking.cliente_nome, row.booking.professionals?.nome, formatDuration(row.booking.duracao_min), formatPrice(row.booking.preco_centavos)].filter(Boolean).join(" · ")}
        </p>
        <a className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 hover:underline md:min-h-0" href={`https://wa.me/${row.booking.cliente_whatsapp.length <= 11 ? `55${row.booking.cliente_whatsapp}` : row.booking.cliente_whatsapp}`} target="_blank" rel="noreferrer">
          WhatsApp {formatPhone(row.booking.cliente_whatsapp)}
        </a>
      </ReservationCard>
    )

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Visão" className="flex w-full gap-1 sm:w-auto">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)}
              className={cn("min-h-11 flex-1 rounded-md border px-4 text-sm font-medium sm:flex-none md:min-h-10", view === v.id ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-surface-alt")}>
              {v.label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="icon" className="h-11 w-11 md:h-10 md:w-10" aria-label={`Anterior (${unit})`} onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
        <Button variant="outline" className="h-11 md:h-10" onClick={() => setDate(todayIn(tz))}>Hoje</Button>
        <Button variant="outline" size="icon" className="h-11 w-11 md:h-10 md:w-10" aria-label={`Próximo (${unit})`} onClick={() => step(1)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
        {!readOnly && <Button className="ml-auto h-11 gap-1 md:h-10" onClick={() => setScheduling(true)}><CalendarPlus className="h-4 w-4" aria-hidden="true" />Novo agendamento</Button>}
        {!readOnly && <Button variant="outline" className="h-11 gap-1 md:h-10" onClick={() => setBlocking(true)}><Lock className="h-4 w-4" aria-hidden="true" />Bloquear horário</Button>}
        <h2 className="order-last w-full font-display text-xl font-semibold tracking-wide" aria-live="polite">{title}</h2>
      </div>

      {!bookings.data || !blocks.data ? (
        <div role="status" aria-label="Carregando agenda" className="flex flex-col gap-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
      ) : view === "dia" ? (
        count(date) === 0 ? (
          <Panel><EmptyState title="Nenhum atendimento neste dia" description={readOnly ? "Seus atendimentos aparecem aqui." : "As reservas feitas pela página pública aparecem aqui."} /></Panel>
        ) : (
          <ul className="flex flex-col gap-3">{rowsOf(date).map(renderRow)}</ul>
        )
      ) : view === "semana" ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((day) => (
            <section key={day} aria-label={formatDay(day)} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground">{formatDay(day)} · {count(day)} {count(day) === 1 ? "item" : "itens"}</h3>
              {count(day) > 0 && <ul className="flex flex-col gap-3">{rowsOf(day).map(renderRow)}</ul>}
            </section>
          ))}
        </div>
      ) : (
        <Panel className="p-3 sm:p-4">
          <div className="grid grid-cols-7 gap-1 text-center text-[13px] text-muted-foreground" aria-hidden="true">
            {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => <span key={d}>{d}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {monthGrid(date).map((day, i) =>
              day ? (
                <button key={day} type="button" onClick={() => { setDate(day); setView("dia") }}
                  aria-label={`${formatDay(day)}, ${count(day)} ${count(day) === 1 ? "item" : "itens"}`}
                  className={cn("flex min-h-12 flex-col items-center justify-center rounded-md border text-sm tabular-nums hover:bg-surface-alt", day === todayIn(tz) ? "border-primary" : "border-border", count(day) > 0 && "bg-primary/10")}>
                  {Number(day.slice(8))}
                  {count(day) > 0 && <span className="text-[11px] font-semibold">{count(day)}</span>}
                </button>
              ) : <span key={`v${i}`} />
            )}
          </div>
        </Panel>
      )}

      <ConfirmDelete
        open={canceling !== null} title="Cancelar esta reserva?" cancelLabel="Manter reserva" confirmLabel="Cancelar reserva"
        description={canceling ? `${canceling.servico_nome} de ${canceling.cliente_nome}. O horário volta a ficar livre.` : ""}
        pending={cancel.isPending} onConfirm={() => canceling && cancel.mutate(canceling)} onClose={() => setCanceling(null)}
      />
      {!readOnly && <BlockDialog open={blocking} shopId={shopId} tz={tz} date={date} professionals={professionals} onClose={() => setBlocking(false)} onDone={refresh} />}
      {!readOnly && <ManualBookingDialog open={scheduling} shopId={shopId} tz={tz} date={date} professionals={professionals} onClose={() => setScheduling(false)} onDone={refresh} />}
    </>
  )
}

/** Início e fim do bloqueio: data e hora escolhidas em pop-up (o valor segue no formulário pelo nome). */
function BlockTimes({ date }: { date: string }) {
  const [inicio, setInicio] = useState(`${date}T09:00`)
  const [fim, setFim] = useState(`${date}T10:00`)
  return (
    <>
      <Field label="Início" htmlFor="bl-ini"><DateTimeField id="bl-ini" name="inicio" value={inicio} onChange={setInicio} /></Field>
      <Field label="Fim" htmlFor="bl-fim"><DateTimeField id="bl-fim" name="fim" value={fim} onChange={setFim} /></Field>
    </>
  )
}

function BlockDialog({ open, shopId, tz, date, professionals, onClose, onDone }: {
  open: boolean; shopId: string; tz: string; date: string; professionals: Professional[]; onClose: () => void; onDone: () => Promise<unknown>
}) {
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (v: { prof: string; inicio: string; fim: string; motivo: string }) => createBlock(shopId, v.prof, v.inicio, v.fim, v.motivo),
    onSuccess: async () => { await onDone(); toast.success("Horário bloqueado."); onClose() },
    onError: (e) => setError(bookingErrorMessage(e).replace("Este horário acabou de ser ocupado. Escolha outro.", "Já existe uma reserva ou bloqueio neste intervalo.")),
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const prof = String(data.get("prof") ?? "")
    const inicio = String(data.get("inicio") ?? "")
    const fim = String(data.get("fim") ?? "")
    if (!prof || !inicio || !fim || fim <= inicio) { setError("Escolha o profissional e um intervalo com o fim depois do início."); return }
    setError(null)
    save.mutate({ prof, inicio: zonedToUtc(inicio, tz), fim: zonedToUtc(fim, tz), motivo: String(data.get("motivo") ?? "") })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setError(null); onClose() } }}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-[480px] overflow-y-auto bg-card">
        <div className="flex flex-col gap-1.5 pr-8 text-left">
          <DialogTitle className="font-display text-2xl font-bold tracking-wide">Bloquear horário</DialogTitle>
          <DialogDescription>Folga, almoço ou compromisso. Ninguém consegue reservar neste intervalo.</DialogDescription>
        </div>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" key={date}>
          {error && <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Profissional</legend>
            {professionals.map((p) => (
              <label key={p.id} className="flex min-h-11 items-center gap-3 text-sm md:min-h-8"><input type="radio" name="prof" value={p.id} className="h-5 w-5 accent-primary" />{p.nome}</label>
            ))}
          </fieldset>
          <BlockTimes date={date} />
          <Field label="Motivo (opcional)" htmlFor="bl-mot"><Input id="bl-mot" name="motivo" maxLength={200} className="h-11 text-base md:h-10 md:text-sm" /></Field>
          <Button type="submit" className="h-11 w-full md:h-10" disabled={save.isPending}>{save.isPending ? "Bloqueando…" : "Bloquear horário"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
