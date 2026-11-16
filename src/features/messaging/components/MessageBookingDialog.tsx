import { useState } from "react"
import { formatPhone } from "@/lib/br"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { cancelBooking, setBookingStatus } from "@/features/booking/api"
import { RescheduleForm } from "@/features/booking/components/RescheduleDialog"
import { bookingErrorMessage, canReschedule, formatDateTime, STATUS_LABEL, type BookingStatus } from "@/features/booking/domain"
import { ProfessionalTag } from "@/features/catalog/components/ProfessionalPhoto"
import { formatPrice } from "@/features/catalog/domain"
import { confirmPayment, discardPayment, fetchPayments, registerPayment } from "@/features/finance/api"
import { InstallmentsSelect, PaymentFormLabel, PaymentFormSelect } from "@/features/finance/components/PaymentForm"
import { confirmedTotal, financeErrorMessage, newKey, pendingTotal, remainingToDeclare, remainingToReceive, type PaymentForm } from "@/features/finance/domain"
import { Button } from "@/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog"
import { Field, MoneyInput, StatusBadge } from "@/ui/finance"
import { toast } from "@/ui/sonner"
import type { InboundRow, OutboxBooking, OutboxRow } from "../api"
import { eventLabel, inboundReasonLabel, outboxReasonLabel, outboxStatusVariant, statusLabel } from "../domain"

const BADGE: Record<BookingStatus, "income" | "warning" | "danger" | "default"> = {
  pendente: "warning", confirmado: "income", concluido: "default", cancelado: "danger", nao_compareceu: "danger",
}

type Panel = "reagendar" | "pagamento" | "cancelar" | null

/** Pop-up com os dados da reserva de uma mensagem e as ações da gestão: aceitar, reagendar, receber pagamento e cancelar. */
export function MessageBookingDialog({ message, shopId, tz, onClose, reply }: { message: OutboxRow | null; shopId: string; tz: string; onClose: () => void; reply?: InboundRow | null }) {
  const booking = message?.bookings ?? null
  return (
    <Dialog open={Boolean(message && booking)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-2rem)] max-w-[640px] overflow-y-auto bg-card">
        {message && booking && <MessageDetail key={booking.id} message={message} booking={booking} shopId={shopId} tz={tz} onClose={onClose} reply={reply} />}
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  )
}

/**
 * Dados da reserva da mensagem e as ações da gestão. `variant="painel"` é o painel de detalhes da Central (desktop);
 * `"dialog"` é o pop-up (tablet e celular). A lógica e as permissões são as mesmas nos dois.
 */
export function MessageDetail({ message, booking, shopId, tz, onClose, variant = "dialog", reply }: { message: OutboxRow; booking: OutboxBooking; shopId: string; tz: string; onClose: () => void; variant?: "dialog" | "painel"; reply?: InboundRow | null }) {
  const queryClient = useQueryClient()
  const [panel, setPanel] = useState<Panel>(null)
  const [error, setError] = useState<string | null>(null)

  const payments = useQuery({ queryKey: ["booking-payments", booking.id], queryFn: () => fetchPayments([booking.id]) })
  const list = payments.data?.payments ?? []
  const refunds = payments.data?.refunds ?? []
  const pago = confirmedTotal(list, refunds) // só o confirmado está no caixa
  const aConfirmar = pendingTotal(list)
  const aReceber = payments.data ? remainingToReceive(booking.preco_centavos, list, refunds) : booking.preco_centavos
  const aDeclarar = payments.data ? remainingToDeclare(booking.preco_centavos, list, refunds) : booking.preco_centavos
  const registrado = pago + aConfirmar // confirmado + a confirmar: trava cancelar
  const active = booking.status === "pendente" || booking.status === "confirmado"
  const canMove = canReschedule(booking)
  const canPay = !payments.isError && (booking.status === "confirmado" || booking.status === "concluido") && (aDeclarar > 0 || aConfirmar > 0)

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["outbox", shopId] }),
      queryClient.invalidateQueries({ queryKey: ["outbox-summary", shopId] }),
      queryClient.invalidateQueries({ queryKey: ["booking-payments", booking.id] }),
      queryClient.invalidateQueries({ queryKey: ["finance-report", shopId] }),
      queryClient.invalidateQueries({ queryKey: ["payments", shopId] }),
      queryClient.invalidateQueries({ queryKey: ["completed-bookings", shopId] }),
      queryClient.invalidateQueries({ queryKey: ["slots"] }),
    ])
  }
  const fail = (e: unknown) => setError(financeErrorMessage(e) !== "Não foi possível concluir. Tente novamente." ? financeErrorMessage(e) : bookingErrorMessage(e))

  const accept = useMutation({
    mutationFn: () => setBookingStatus(booking.id, "confirmado"),
    onSuccess: async () => { setError(null); await refresh(); toast.success("Reserva aceita."); onClose() },
    onError: fail,
  })
  const confirm = useMutation({
    mutationFn: (id: string) => confirmPayment(id),
    onSuccess: async () => { setError(null); await refresh(); toast.success("Pagamento confirmado: o valor entrou no caixa.") },
    onError: fail,
  })
  const discard = useMutation({
    mutationFn: (id: string) => discardPayment(id),
    onSuccess: async () => { setError(null); await refresh(); toast.success("Pagamento descartado.") },
    onError: fail,
  })
  const cancel = useMutation({
    mutationFn: () => cancelBooking(booking.id),
    onSuccess: async () => { setError(null); await refresh(); toast.success("Reserva cancelada."); onClose() },
    onError: fail,
  })

  return (
    <>
      <div className="flex flex-col gap-1.5 pr-8 text-left">
        {variant === "dialog" ? (
          <>
            <DialogTitle className="font-display text-2xl font-bold tracking-wide">{booking.cliente_nome}</DialogTitle>
            <DialogDescription>{booking.servico_nome} · {formatDateTime(booking.inicio, tz)}</DialogDescription>
          </>
        ) : (
          <>
            <h2 className="font-display text-2xl font-bold tracking-wide">{booking.cliente_nome}</h2>
            <p className="text-sm text-muted-foreground">{booking.servico_nome} · {formatDateTime(booking.inicio, tz)}</p>
          </>
        )}
      </div>

      <dl className="rounded-card border border-border px-4">
        <Row label="Reserva"><StatusBadge variant={BADGE[booking.status]}>{STATUS_LABEL[booking.status]}</StatusBadge></Row>
        <Row label="WhatsApp">{formatPhone(booking.cliente_whatsapp)}</Row>
        <Row label="Serviço">{booking.servico_nome}</Row>
        <Row label="Profissional">{booking.professionals ? <ProfessionalTag nome={booking.professionals.nome} path={booking.professionals.avatar_path} /> : "—"}</Row>
        <Row label="Data e horário">{formatDateTime(booking.inicio, tz)}</Row>
        <Row label="Valor">{formatPrice(booking.preco_centavos)}</Row>
        <Row label="Pagamento">
          {payments.isError ? <StatusBadge variant="warning">Não foi possível ler</StatusBadge> : payments.isPending ? "…" : (booking.status === "cancelado" || booking.status === "nao_compareceu") && pago <= 0 ? "—" : pago >= booking.preco_centavos ? <StatusBadge variant="income">Pago {formatPrice(pago)}</StatusBadge> : (
            <span className="inline-flex flex-wrap items-center justify-end gap-2">
              {pago > 0 && <span>Pago {formatPrice(pago)} ·</span>}
              {aConfirmar > 0 && <StatusBadge variant="warning">A confirmar {formatPrice(aConfirmar)}</StatusBadge>}
              <StatusBadge variant="default">A receber {formatPrice(aReceber)}</StatusBadge>
            </span>
          )}
        </Row>
        {reply && (
          <Row label="Resposta">
            <span className="inline-flex flex-wrap items-center justify-end gap-2">
              {inboundReasonLabel(reply.motivo) || "Sem detalhes"}
              <StatusBadge variant={reply.status === "processado" ? "income" : reply.status === "rejeitado" ? "danger" : "default"}>{reply.status === "processado" ? "Aplicada" : reply.status === "rejeitado" ? "Rejeitada" : "Ignorada"}</StatusBadge>
            </span>
            <span className="block text-[13px] font-normal text-muted-foreground">{formatDateTime(reply.recebido_em, tz)}</span>
          </Row>
        )}
        <Row label="Mensagem">
          <span className="inline-flex flex-wrap items-center justify-end gap-2">
            {eventLabel(message.tipo)}
            <StatusBadge variant={outboxStatusVariant(message.status)}>{statusLabel(message.status)}</StatusBadge>
          </span>
          {message.ultimo_erro && <span className="block text-[13px] font-normal text-muted-foreground">{outboxReasonLabel(message.ultimo_erro)}</span>}
        </Row>
      </dl>
      <p className="-mt-2 text-[13px] text-muted-foreground">O valor só entra no caixa depois que o pagamento é registrado e confirmado.</p>

      {error && <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {booking.status === "pendente" && (
          <Button className="h-11 md:h-10" disabled={accept.isPending} onClick={() => accept.mutate()}>{accept.isPending ? "Aceitando…" : "Aceitar"}</Button>
        )}
        {canMove && (
          <Button variant="outline" className="h-11 md:h-10" aria-expanded={panel === "reagendar"} onClick={() => { setPanel(panel === "reagendar" ? null : "reagendar"); setError(null) }}>Reagendar</Button>
        )}
        {canPay && (
          <Button variant="outline" className="h-11 md:h-10" aria-expanded={panel === "pagamento"} onClick={() => { setPanel(panel === "pagamento" ? null : "pagamento"); setError(null) }}>Pagamento</Button>
        )}
        {active && (
          <Button variant="outline" className="h-11 text-danger md:h-10" aria-expanded={panel === "cancelar"} onClick={() => { setPanel(panel === "cancelar" ? null : "cancelar"); setError(null) }}>Cancelar</Button>
        )}
      </div>

      {panel === "reagendar" && canMove && (
        <section aria-label="Reagendar" className="flex flex-col gap-3 rounded-card border border-border p-3">
          <h3 className="font-display text-lg font-semibold">Novo dia e horário</h3>
          <RescheduleForm booking={booking} tz={tz} onDone={async () => {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["outbox", shopId] }),
              queryClient.invalidateQueries({ queryKey: ["outbox-summary", shopId] }),
            ])
            onClose()
          }} />
        </section>
      )}

      {panel === "pagamento" && canPay && (
        <section aria-label="Pagamentos" className="flex flex-col gap-3">
          {list.length > 0 && (
            <ul aria-label="Pagamentos desta reserva" className="flex flex-col gap-2 rounded-card border border-border p-3">
              {list.map((p) => {
                const confirmado = p.confirmado_em !== null
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <PaymentFormLabel form={p.forma} parcelas={p.parcelas} />
                      <span className="font-medium tabular-nums">{formatPrice(p.valor_centavos)}</span>
                      <StatusBadge variant={confirmado ? "income" : "warning"}>{confirmado ? "Confirmado" : "A confirmar"}</StatusBadge>
                    </span>
                    {!confirmado && (
                      <span className="flex gap-2">
                        <Button className="h-11 md:h-10" disabled={confirm.isPending} onClick={() => confirm.mutate(p.id)}>Confirmar pagamento</Button>
                        <Button variant="outline" className="h-11 md:h-10" disabled={discard.isPending} onClick={() => discard.mutate(p.id)}>Descartar</Button>
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {aDeclarar > 0 && <PaymentSection booking={booking} max={aDeclarar} onDone={async () => { await refresh(); toast.success("Pagamento registrado. Confirme para o valor entrar no caixa.") }} />}
        </section>
      )}

      {panel === "cancelar" && (
        <section aria-label="Cancelar reserva" className="flex flex-col gap-3 rounded-card border border-danger/30 bg-danger/5 p-3">
          {registrado > 0 ? (
            <p className="text-sm">Esta reserva tem {formatPrice(registrado)} em pagamentos. {aConfirmar > 0 ? "Descarte os pagamentos a confirmar" : "Estorne o pagamento (Financeiro → Pagamentos)"} antes de cancelar.</p>
          ) : (
            <p className="text-sm">Cancelar a reserva de {booking.cliente_nome}? O horário volta a ficar livre.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11 md:h-10" onClick={() => setPanel(null)}>Manter reserva</Button>
            <Button className="h-11 md:h-10" disabled={cancel.isPending || registrado > 0} onClick={() => cancel.mutate()}>{cancel.isPending ? "Cancelando…" : "Confirmar cancelamento"}</Button>
          </div>
        </section>
      )}
    </>
  )
}

function PaymentSection({ booking, max, onDone }: { booking: OutboxBooking; max: number; onDone: () => Promise<void> }) {
  const [valor, setValor] = useState<number | null>(max)
  const [forma, setForma] = useState<PaymentForm>("pix")
  const [parcelas, setParcelas] = useState("1")
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState(newKey)
  const pay = useMutation({
    mutationFn: (cents: number) => registerPayment({ bookingId: booking.id, valor: cents, forma, parcelas: forma === "credito" ? Number(parcelas) : 1, key }),
    onSuccess: async () => { setKey(newKey()); setError(null); await onDone() },
    onError: (e) => setError(financeErrorMessage(e)),
  })
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!valor) { setError("Informe um valor maior que zero."); return }
    if (valor > max) { setError(`O valor não pode passar do que falta receber (${formatPrice(max)}).`); return }
    pay.mutate(valor)
  }
  return (
    <form onSubmit={submit} noValidate aria-label="Registrar pagamento" className="grid gap-3 rounded-card border border-border p-3 sm:grid-cols-2">
      <Field label="Valor (R$)" htmlFor="pg-valor"><MoneyInput id="pg-valor" defaultCents={max} onCentsChange={setValor} /></Field>
      <Field label="Forma de pagamento" htmlFor="pg-forma">
        <PaymentFormSelect id="pg-forma" value={forma} onChange={setForma} />
      </Field>
      {forma === "credito" && (
        <Field label="Parcelas" htmlFor="pg-parcelas">
          <InstallmentsSelect id="pg-parcelas" value={parcelas} onChange={setParcelas} />
        </Field>
      )}
      <div className="flex flex-col gap-2 sm:col-span-2">
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" className="h-11 sm:w-fit md:h-10" disabled={pay.isPending}>{pay.isPending ? "Registrando…" : "Registrar pagamento"}</Button>
      </div>
    </form>
  )
}
