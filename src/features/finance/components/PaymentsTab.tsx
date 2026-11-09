import { useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, Search } from "lucide-react"
import { ProfessionalTag } from "@/features/catalog/components/ProfessionalPhoto"
import { formatPrice } from "@/features/catalog/domain"
import type { MyBarbershop } from "@/features/home/domain"
import { formatTime, localDate } from "@/features/booking/domain"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { EmptyState, Field, MoneyInput, StatusBadge } from "@/ui/finance"
import { Input } from "@/ui/input"
import { OptionSelect } from "@/ui/option-select"
import { toast } from "@/ui/sonner"
import { confirmPayment, discardPayment, fetchCompletedBookings, fetchPayments, refundPayment, registerPayment, type CompletedBooking, type PaymentRow, type RefundRow } from "../api"
import { financeErrorMessage, newKey, pendingTotal, remainingToDeclare, remainingToReceive, PAYMENT_FORMS, type PaymentForm } from "../domain"
import { FIELD, Loading, QueryError, Section, StatStrip } from "./FinanceUI"
import { InstallmentsSelect, PaymentFormLabel, PaymentFormSelect } from "./PaymentForm"

type Situation = "todas" | "a_confirmar" | "falta" | "pago"

/** "06/11 · 23:41": curto o bastante para caber numa linha da tabela. */
const shortDate = (iso: string, tz: string) => { const d = localDate(iso, tz); return `${d.slice(8)}/${d.slice(5, 7)} · ${formatTime(iso, tz)}` }

const GRID = "xl:grid-cols-[104px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_112px_minmax(0,1.1fr)_auto]"

export function PaymentsTab({ shop }: { shop: MyBarbershop }) {
  const tz = shop.fuso ?? "America/Sao_Paulo"
  const bookings = useQuery({ queryKey: ["completed-bookings", shop.id], queryFn: () => fetchCompletedBookings(shop.id) })
  const ids = (bookings.data ?? []).map((b) => b.id)
  const pays = useQuery({ queryKey: ["payments", shop.id, ids.join(",")], queryFn: () => fetchPayments(ids), enabled: bookings.isSuccess })
  const [open, setOpen] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [prof, setProf] = useState("todos")
  const [situation, setSituation] = useState<Situation>("todas")
  const [form, setForm] = useState("todas")

  const rows = useMemo(() => {
    if (!bookings.data || !pays.data) return []
    return bookings.data.map((b) => {
      const mine = pays.data.payments.filter((p) => p.booking_id === b.id)
      const refunds = pays.data.refunds.filter((r) => mine.some((p) => p.id === r.payment_id))
      const faltam = remainingToReceive(b.preco_centavos, mine, refunds)
      return { b, mine, refunds, faltam, aConfirmar: pendingTotal(mine), forms: [...new Set(mine.map((p) => p.forma))] }
    })
  }, [bookings.data, pays.data])

  if (bookings.isError) return <QueryError error={bookings.error} onRetry={() => void bookings.refetch()} />
  if (pays.isError) return <QueryError error={pays.error} onRetry={() => void pays.refetch()} />
  if (!bookings.data || !pays.data) return <Loading label="Carregando atendimentos" />
  if (bookings.data.length === 0) {
    return <Section title="Pagamentos"><EmptyState title="Nenhum atendimento concluído" description="Depois de concluir um atendimento na agenda, registre aqui como foi pago." /></Section>
  }

  const professionals = [...new Map(bookings.data.filter((b) => b.professionals).map((b) => [b.professionals!.nome, b.professionals!.nome])).values()]
  const term = search.trim().toLowerCase()
  const shown = rows.filter(({ b, faltam, aConfirmar, forms }) =>
    (!term || `${b.cliente_nome} ${b.servico_nome}`.toLowerCase().includes(term)) &&
    (prof === "todos" || b.professionals?.nome === prof) &&
    (form === "todas" || forms.includes(form as PaymentForm)) &&
    (situation === "todas" || (situation === "a_confirmar" ? aConfirmar > 0 : situation === "falta" ? faltam > 0 : faltam === 0)),
  )
  const totalAConfirmar = rows.reduce((t, r) => t + r.aConfirmar, 0)
  const totalFalta = rows.reduce((t, r) => t + r.faltam, 0)
  const filtered = term !== "" || prof !== "todos" || situation !== "todas" || form !== "todas"

  return (
    <div className="flex flex-col gap-4">
      <StatStrip items={[
        { label: "Atendimentos concluídos", value: String(rows.length) },
        { label: "Declarado, a confirmar", value: formatPrice(totalAConfirmar), tone: "warning" },
        { label: "Falta receber", value: formatPrice(totalFalta) },
        { label: "Totalmente pagos", value: String(rows.filter((r) => r.faltam === 0).length), tone: "income" },
      ]} />

      <Section title="Pagamentos" description={`Últimos ${rows.length} atendimentos concluídos. Os pagamentos são declarados pela barbearia; confirmar lança o valor no caixa.`}>
        <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Buscar cliente ou serviço" placeholder="Buscar cliente ou serviço" value={search} onChange={(e) => setSearch(e.target.value)} className={cn(FIELD, "pl-9")} />
          </div>
          <OptionSelect aria-label="Profissional" value={prof} onValueChange={setProf} options={[{ value: "todos", label: "Todos os profissionais" }, ...professionals.map((n) => ({ value: n, label: n }))]} />
          <OptionSelect aria-label="Forma de pagamento" value={form} onValueChange={setForm} options={[{ value: "todas", label: "Todas as formas" }, ...PAYMENT_FORMS.map((f) => ({ value: f.value, label: f.label }))]} />
          <OptionSelect aria-label="Situação" value={situation} onValueChange={(v) => setSituation(v as Situation)} options={[
            { value: "todas", label: "Todas as situações" }, { value: "a_confirmar", label: "A confirmar" }, { value: "falta", label: "Falta receber" }, { value: "pago", label: "Pago" },
          ]} />
        </div>

        {shown.length === 0 ? (
          <EmptyState title="Nenhum atendimento encontrado" description={filtered ? "Nenhum atendimento combina com a busca e os filtros." : "Sem atendimentos para mostrar."} action={filtered ? <Button variant="outline" className="h-11 md:h-10" onClick={() => { setSearch(""); setProf("todos"); setSituation("todas"); setForm("todas") }}>Limpar filtros</Button> : undefined} />
        ) : (
          <div>
            <div aria-hidden="true" className={cn("hidden gap-x-4 border-b border-border px-3 pb-2 text-xs font-medium text-muted-foreground xl:grid", GRID)}>
              <span>Data</span><span>Cliente</span><span>Serviço</span><span>Profissional</span><span>Valor</span><span>Pagamento</span><span className="w-[140px]" />
            </div>
            <ul className="divide-y divide-border">
              {shown.map(({ b, mine, refunds, faltam, aConfirmar, forms }) => (
                <li key={b.id} className="flex flex-col gap-2 py-3 xl:px-3">
                  <div className={cn("grid items-center gap-x-4 gap-y-2", GRID)}>
                    <span className="text-sm text-muted-foreground xl:text-foreground">{shortDate(b.inicio, tz)}</span>
                    <span className="min-w-0 truncate text-base font-semibold xl:text-sm">{b.cliente_nome}</span>
                    <span className="min-w-0 truncate text-sm text-muted-foreground xl:text-foreground">{b.servico_nome}</span>
                    <span className="min-w-0 text-sm">{b.professionals ? <ProfessionalTag nome={b.professionals.nome} path={b.professionals.avatar_path} /> : "—"}</span>
                    <span className="font-display text-sm font-semibold tabular-nums">{formatPrice(b.preco_centavos)}</span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                      <span className="inline-flex flex-wrap items-center gap-x-3 text-muted-foreground">
                        {forms.length === 0 ? "Sem pagamento" : forms.map((f) => <PaymentFormLabel key={f} form={f} parcelas={mine.find((p) => p.forma === f)?.parcelas} />)}
                      </span>
                      {aConfirmar > 0 && <StatusBadge variant="warning">A confirmar {formatPrice(aConfirmar)}</StatusBadge>}
                      <StatusBadge variant={faltam === 0 ? "income" : "default"}>{faltam === 0 ? "Pago" : `Falta ${formatPrice(faltam)}`}</StatusBadge>
                    </span>
                    <Button variant="outline" className="h-11 w-full justify-between gap-2 sm:w-fit md:h-10 xl:w-[140px]" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>
                      {open === b.id ? "Fechar" : "Pagamentos"}
                      <ChevronDown aria-hidden="true" className={cn("h-4 w-4 transition-transform", open === b.id && "rotate-180")} />
                    </Button>
                  </div>
                  {open === b.id && <PaymentPanel shopId={shop.id} booking={b} payments={mine} refunds={refunds} />}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>
    </div>
  )
}

function PaymentPanel({ shopId, booking, payments, refunds }: { shopId: string; booking: CompletedBooking; payments: PaymentRow[]; refunds: RefundRow[] }) {
  const faltam = remainingToDeclare(booking.preco_centavos, payments, refunds)
  const queryClient = useQueryClient()
  const [forma, setForma] = useState<PaymentForm>("pix")
  const [valor, setValor] = useState<number | null>(faltam)
  const [parcelas, setParcelas] = useState("1")
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState(newKey)
  const [refunding, setRefunding] = useState<string | null>(null)
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["payments", shopId] }),
      queryClient.invalidateQueries({ queryKey: ["payments-window", shopId] }),
      queryClient.invalidateQueries({ queryKey: ["refunds-window", shopId] }),
      queryClient.invalidateQueries({ queryKey: ["finance-report", shopId] }),
      queryClient.invalidateQueries({ queryKey: ["commissions", shopId] }),
    ])
  }
  const confirm = useMutation({
    mutationFn: (id: string) => confirmPayment(id),
    onSuccess: async () => { await refresh(); toast.success("Pagamento confirmado: o valor entrou no caixa.") },
    onError: (e) => toast.error(financeErrorMessage(e)),
  })
  const discard = useMutation({
    mutationFn: (id: string) => discardPayment(id),
    onSuccess: async () => { await refresh(); toast.success("Pagamento descartado.") },
    onError: (e) => toast.error(financeErrorMessage(e)),
  })
  const pay = useMutation({
    mutationFn: (v: { valor: number; parcelas: number }) => registerPayment({ bookingId: booking.id, valor: v.valor, forma, parcelas: v.parcelas, key }),
    onSuccess: async () => { setKey(newKey()); setError(null); await refresh(); toast.success("Pagamento registrado. Confirme para o valor entrar no caixa.") },
    onError: (e) => setError(financeErrorMessage(e)),
  })
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const cents = valor
    if (!cents) { setError("Informe um valor maior que zero, como 60,00."); return }
    pay.mutate({ valor: cents, parcelas: forma === "credito" ? Number(parcelas) : 1 })
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border bg-surface-alt p-3 sm:p-4">
      {payments.length > 0 && (
        <ul className="flex flex-col gap-2">
          {payments.map((p) => {
            const estornado = refunds.filter((r) => r.payment_id === p.id).reduce((t, r) => t + r.valor_centavos, 0)
            const confirmado = p.confirmado_em !== null
            return (
              <li key={p.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <PaymentFormLabel form={p.forma} parcelas={p.parcelas} />
                    <span className="font-medium tabular-nums">{formatPrice(p.valor_centavos)}{estornado > 0 ? ` (estornado ${formatPrice(estornado)})` : ""}</span>
                    <StatusBadge variant={confirmado ? "income" : "warning"}>{confirmado ? "Confirmado" : "A confirmar"}</StatusBadge>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {!confirmado && <Button className="h-11 md:h-10" disabled={confirm.isPending} onClick={() => confirm.mutate(p.id)}>Confirmar pagamento</Button>}
                    {!confirmado && <Button variant="outline" className="h-11 md:h-10" disabled={discard.isPending} onClick={() => discard.mutate(p.id)}>Descartar</Button>}
                    {confirmado && estornado < p.valor_centavos && <Button variant="outline" className="h-11 md:h-10" onClick={() => setRefunding(refunding === p.id ? null : p.id)}>Estornar</Button>}
                  </span>
                </div>
                {refunding === p.id && <RefundForm payment={p} max={p.valor_centavos - estornado} onDone={async () => { setRefunding(null); await refresh() }} />}
              </li>
            )
          })}
        </ul>
      )}
      {faltam > 0 ? (
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-3" noValidate>
          <Field label="Valor (R$)" htmlFor={`valor-${booking.id}`}>
            <MoneyInput id={`valor-${booking.id}`} defaultCents={faltam} onCentsChange={setValor} />
          </Field>
          <Field label="Forma de pagamento" htmlFor={`forma-${booking.id}`}>
            <PaymentFormSelect id={`forma-${booking.id}`} value={forma} onChange={setForma} />
          </Field>
          {forma === "credito" && (
            <Field label="Parcelas" htmlFor={`parcelas-${booking.id}`}>
              <InstallmentsSelect id={`parcelas-${booking.id}`} value={parcelas} onChange={setParcelas} />
            </Field>
          )}
          <div className="sm:col-span-3 flex flex-col gap-2">
            {error && <p role="alert" className="text-sm text-expense">{error}</p>}
            <Button type="submit" className="h-11 md:h-10 sm:w-fit" disabled={pay.isPending}>{pay.isPending ? "Registrando…" : "Registrar pagamento"}</Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Todo o valor deste atendimento já foi declarado.</p>
      )}
    </div>
  )
}

function RefundForm({ payment, max, onDone }: { payment: PaymentRow; max: number; onDone: () => Promise<void> }) {
  const [valor, setValor] = useState<number | null>(max)
  const [motivo, setMotivo] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [key] = useState(newKey)
  const refund = useMutation({
    mutationFn: (cents: number) => refundPayment({ paymentId: payment.id, valor: cents, motivo, key }),
    onSuccess: async () => { toast.success("Estorno registrado."); await onDone() },
    onError: (e) => setError(financeErrorMessage(e)),
  })
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const cents = valor
    if (!cents || cents > max) { setError(`Informe um valor entre R$ 0,01 e ${formatPrice(max)}.`); return }
    refund.mutate(cents)
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-2" noValidate>
      <Field label="Valor do estorno (R$)" htmlFor={`est-${payment.id}`}><MoneyInput id={`est-${payment.id}`} defaultCents={max} onCentsChange={setValor} /></Field>
      <Field label="Motivo (opcional)" htmlFor={`mot-${payment.id}`}><Input id={`mot-${payment.id}`} value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} className={FIELD} /></Field>
      <div className="sm:col-span-2 flex flex-col gap-2">
        {error && <p role="alert" className="text-sm text-expense">{error}</p>}
        <Button type="submit" variant="outline" className="h-11 md:h-10 sm:w-fit" disabled={refund.isPending}>Confirmar estorno</Button>
      </div>
    </form>
  )
}
