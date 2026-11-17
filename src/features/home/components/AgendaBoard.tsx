import { useId } from "react"
import { ProfessionalTag } from "@/features/catalog/components/ProfessionalPhoto"
import { Link } from "react-router-dom"
import { ArrowRight, CalendarClock } from "lucide-react"
import { STATUS_LABEL, formatDay, formatTime, localDate, type BookingRow, type BookingStatus } from "@/features/booking/domain"
import { StatusBadge } from "@/ui/finance"
import { Skeleton } from "@/ui/skeleton"

type AgendaBoardProps = {
  customerOnly: boolean
  /** undefined = carregando */
  rows: BookingRow[] | undefined
  tz: string
  /** Dia escolhido no calendário: troca o título e o vazio, e oferece voltar aos próximos. */
  day?: { label: string; onClear: () => void }
}

const COPY = {
  team: { title: "Próximos atendimentos", empty: "Nenhum atendimento agendado", columns: ["Hora", "Serviço", "Cliente", "Profissional"] },
  customer: { title: "Seus próximos agendamentos", empty: "Nenhum agendamento marcado", columns: ["Hora", "Serviço", "Barbearia", "Profissional"] },
}

const GRID = "sm:grid-cols-[96px_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_112px]"

const STATUS: Record<BookingStatus, "income" | "warning" | "danger" | "default"> = {
  pendente: "warning", confirmado: "income", concluido: "default", cancelado: "danger", nao_compareceu: "danger",
}

export function AgendaBoard({ customerOnly, rows, tz, day }: AgendaBoardProps) {
  const titleId = useId()
  const copy = customerOnly ? COPY.customer : COPY.team
  const today = localDate(new Date(), tz)
  const head = "hidden gap-3 border-b border-border pb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase sm:grid"

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col rounded-card border border-border bg-card p-4 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="flex items-center gap-3 font-display text-xl font-semibold tracking-wide sm:text-2xl">
          <CalendarClock className="h-6 w-6 text-primary" aria-hidden="true" />
          {day ? `Atendimentos de ${day.label}` : copy.title}
        </h2>
        {day ? (
          <button type="button" onClick={day.onClear} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline md:min-h-9">
            Ver próximos
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <Link
            to={customerOnly ? "/minhas-reservas" : "/agendamentos"}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline md:min-h-9"
          >
            Ver agenda
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </div>

      {!rows ? (
        <div role="status" aria-label="Carregando atendimentos" className="mt-4 flex flex-col gap-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
      ) : rows.length === 0 ? (
        <>
          <div aria-hidden="true" className={`mt-4 ${GRID} ${head}`}>
            {copy.columns.map((column) => <span key={column}>{column}</span>)}<span />
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-2 py-10 text-center sm:py-14">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><CalendarClock className="h-5 w-5" aria-hidden="true" /></div>
            <p className="text-base font-semibold">{day ? "Nenhum atendimento neste dia" : copy.empty}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{day ? "Escolha outro dia no calendário." : "Os horários aparecem aqui assim que houver reservas."}</p>
          </div>
        </>
      ) : (
        <>
          <div aria-hidden="true" className={`mt-4 ${GRID} ${head}`}>
            {copy.columns.map((column) => <span key={column}>{column}</span>)}<span />
          </div>
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const who = customerOnly ? row.barbershops?.nome ?? "" : row.cliente_nome
              return (
                <li key={row.id} className={`grid ${GRID} items-center gap-3 py-3.5 text-sm max-sm:grid-cols-[72px_1fr]`}>
                  <span className="flex items-center gap-3 font-semibold tabular-nums">
                    <span aria-hidden="true" className="h-8 w-0.5 shrink-0 rounded-full bg-primary" />
                    <span>
                      {localDate(row.inicio, tz) !== today && <span className="block text-[13px] font-normal text-muted-foreground">{formatDay(localDate(row.inicio, tz), "curto")}</span>}
                      {formatTime(row.inicio, tz)}
                    </span>
                  </span>
                  <span className="min-w-0 truncate text-base font-semibold">{row.servico_nome}</span>
                  <span className="flex min-w-0 items-center gap-2.5 text-muted-foreground max-sm:col-start-2">
                    {!customerOnly && <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-alt text-xs font-semibold text-foreground">{who.charAt(0).toUpperCase()}</span>}
                    <span className="truncate">{who}</span>
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground max-sm:col-start-2">{row.professionals && <ProfessionalTag nome={row.professionals.nome} path={row.professionals.avatar_path} />}</span>
                  <span className="max-sm:col-start-2 sm:justify-self-end"><StatusBadge variant={STATUS[row.status]}>{STATUS_LABEL[row.status]}</StatusBadge></span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
