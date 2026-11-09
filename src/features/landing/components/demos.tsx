import { Check, Scissors } from "lucide-react"
import { cn } from "@/lib/utils"
import { StatusBadge } from "@/ui/finance"

/*
 * Ilustrações da interface em HTML. Não consultam dados e não têm controles:
 * cada uma é uma imagem (role="img") descrita em aria-label.
 */

const AGENDA_ROWS = [
  { time: "09:00", service: "Corte", who: "Barbeiro 1", status: "Confirmado", variant: "income" },
  { time: "09:40", service: "Barba", who: "Barbeiro 1", status: "Confirmado", variant: "income" },
  { time: "10:00", service: "Corte e barba", who: "Barbeiro 2", status: "Pendente", variant: "warning" },
  { time: "10:20", service: "Sobrancelha", who: "Barbeiro 1", status: "Confirmado", variant: "income" },
  { time: "11:00", service: "Corte", who: "Barbeiro 2", status: "Confirmado", variant: "income" },
  { time: "12:00", service: "Almoço", who: "Barbeiro 1", status: "Bloqueado", variant: "default" },
  { time: "13:00", service: "Hidratação", who: "Barbeiro 2", status: "Pendente", variant: "warning" },
  { time: "14:00", service: "Corte", who: "Barbeiro 1", status: "Confirmado", variant: "income" },
  { time: "14:40", service: "Barba", who: "Barbeiro 2", status: "Confirmado", variant: "income" },
  { time: "15:00", service: "Corte", who: "Barbeiro 1", status: "Pendente", variant: "warning" },
  { time: "15:40", service: "Sobrancelha", who: "Barbeiro 2", status: "Confirmado", variant: "income" },
] as const

function WindowBar({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
      <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-primary text-primary-foreground">
        <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="text-sm font-semibold">{title}</span>
    </div>
  )
}

/** Janela do hero: cortada pela moldura à direita e embaixo; a margem direita fica vazia para o corte. */
export function HeroCollage() {
  return (
    <div
      data-demo
      role="img"
      aria-label="Agenda do dia com horários, serviços, profissionais e status, e o aviso de um agendamento confirmado."
      className="relative min-h-56 flex-1 overflow-hidden rounded-card border border-border bg-surface-alt bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:20px_20px]"
    >
      <div className="absolute top-4 left-4 w-[calc(100%-1rem)] rounded-t-md border border-border bg-card text-foreground shadow-sm lg:top-16 lg:left-16 lg:w-[calc(100%-2.25rem)]">
        <WindowBar title="Agenda de hoje" />
        <ul className="divide-y divide-border">
          {AGENDA_ROWS.map((row) => (
            <li key={`${row.time}-${row.who}`} className="flex items-center gap-3 py-3 pr-8 pl-4 lg:pr-16">
              <span className="w-11 shrink-0 text-sm font-semibold tabular-nums">{row.time}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{row.service}</span>
                <span className="block truncate text-[13px] text-muted-foreground">{row.who}</span>
              </span>
              <StatusBadge variant={row.variant}>{row.status}</StatusBadge>
            </li>
          ))}
        </ul>
      </div>

      <div className="absolute bottom-8 left-8 hidden w-[300px] items-center gap-3 rounded-md border border-border bg-card p-4 text-foreground shadow-lg lg:flex">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-income/10 text-income">
          <Check className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Agendamento confirmado</span>
          <span className="block text-[13px] text-muted-foreground">Corte às 09:00 com Barbeiro 1</span>
        </span>
      </div>
    </div>
  )
}

export function PublicPageDemo() {
  return (
    <div data-demo role="img" aria-label="Página pública da barbearia com o endereço próprio e a lista de serviços." className="rounded-md bg-surface-alt p-4">
      <p className="truncate rounded-sm bg-card px-3 py-2 text-[13px] text-muted-foreground">/sua-barbearia</p>
      <ul className="mt-3 flex flex-wrap gap-2 text-[13px]">
        {["Corte", "Barba", "Sobrancelha", "Hidratação"].map((item) => (
          <li key={item} className="rounded-sm border border-border bg-card px-2.5 py-1">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function WorkingHoursDemo() {
  const days = [
    ["Segunda a sexta", "08:00 às 18:00"],
    ["Sábado", "09:00 às 16:00"],
    ["Domingo", "Folga"],
  ]
  return (
    <div data-demo role="img" aria-label="Jornada semanal de um barbeiro, com horários de segunda a sábado e folga no domingo." className="rounded-md bg-surface-alt p-4">
      <ul className="divide-y divide-border rounded-sm bg-card text-[13px]">
        {days.map(([day, hours]) => (
          <li key={day} className="flex justify-between gap-3 px-3 py-2">
            <span>{day}</span>
            <span className="text-muted-foreground tabular-nums">{hours}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ConflictDemo() {
  return (
    <div data-demo role="img" aria-label="Horário das 09:00 ocupado e recusado, com os horários livres ao lado." className="rounded-md bg-surface-alt p-4">
      <ul className="grid grid-cols-3 gap-2 text-center text-[13px] tabular-nums">
        <li className="rounded-sm border border-danger/40 bg-danger/10 py-1.5 text-danger line-through">09:00</li>
        <li className="rounded-sm border border-border bg-card py-1.5">09:40</li>
        <li className="rounded-sm border border-border bg-card py-1.5">10:20</li>
      </ul>
      <p className="mt-3 text-[13px] text-danger">Horário ocupado. Escolha outro.</p>
    </div>
  )
}

export function RolesDemo() {
  const roles = ["Proprietário", "Gerente", "Barbeiro", "Cliente"]
  return (
    <div data-demo role="img" aria-label="Os quatro papéis de uma barbearia: proprietário, gerente, barbeiro e cliente." className="rounded-md bg-surface-alt p-4">
      <ul className="grid grid-cols-2 gap-2 text-[13px]">
        {roles.map((role) => (
          <li key={role} className="rounded-sm border border-border bg-card px-3 py-1.5">
            {role}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Choice({ label, selected = false, className }: { label: string; selected?: boolean; className?: string }) {
  return (
    <li
      className={cn(
        "flex items-center justify-between gap-2 rounded-sm border px-3 py-2 text-[13px]",
        selected ? "border-primary bg-primary/10 font-semibold" : "border-border bg-card",
        className
      )}
    >
      {label}
      {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
    </li>
  )
}

export function ChooseServiceDemo() {
  return (
    <div data-demo role="img" aria-label="Lista de serviços com Corte selecionado e a opção de qualquer profissional disponível." className="rounded-md bg-surface-alt p-4">
      <ul className="flex flex-col gap-2">
        <Choice label="Corte" selected />
        <Choice label="Barba" />
        <Choice label="Qualquer profissional disponível" selected />
      </ul>
    </div>
  )
}

export function ChooseTimeDemo() {
  return (
    <div data-demo role="img" aria-label="Lista de horários livres com 09:40 selecionado." className="rounded-md bg-surface-alt p-4">
      <ul className="grid grid-cols-3 gap-2 tabular-nums">
        <Choice label="09:00" />
        <Choice label="09:40" selected />
        <Choice label="10:20" />
        <Choice label="11:00" />
        <Choice label="13:30" />
        <Choice label="14:10" />
      </ul>
    </div>
  )
}

export function ConfirmDemo() {
  return (
    <div data-demo role="img" aria-label="Resumo do agendamento confirmado: corte às 09:40 com Barbeiro 2." className="rounded-md bg-surface-alt p-4">
      <div className="rounded-sm border border-border bg-card p-3 text-[13px]">
        <StatusBadge variant="income">Confirmado</StatusBadge>
        <p className="mt-2 font-semibold">Corte às 09:40</p>
        <p className="text-muted-foreground">Com Barbeiro 2</p>
      </div>
    </div>
  )
}

const BARBERS = [
  { name: "Barbeiro 1", count: "3 horários" },
  { name: "Barbeiro 2", count: "2 horários" },
  { name: "Barbeiro 3", count: "Folga hoje" },
]

const COLUMNS = [
  [
    { start: 1, span: 2, title: "Corte", detail: "09:00, 40 min", tone: "confirmed" },
    { start: 3, span: 1, title: "Barba", detail: "09:40, 20 min", tone: "confirmed" },
    { start: 5, span: 2, title: "Corte e barba", detail: "10:20, 40 min", tone: "pending" },
    { start: 7, span: 2, title: "Pausa", detail: "Horário bloqueado", tone: "blocked" },
  ],
  [
    { start: 2, span: 2, title: "Corte", detail: "09:20, 40 min", tone: "confirmed" },
    { start: 6, span: 2, title: "Hidratação", detail: "10:40, 40 min", tone: "pending" },
    { start: 8, span: 1, title: "Pausa", detail: "Horário bloqueado", tone: "blocked" },
  ],
] as const

const TONES = {
  confirmed: "border-income/40 bg-income/10",
  pending: "border-warning/40 bg-warning/10",
  blocked: "border-border bg-surface-alt text-muted-foreground",
}

/** Janela completa: lista de profissionais ao lado da agenda do dia. */
export function AppFrameDemo() {
  const hours = ["09:00", "09:20", "09:40", "10:00", "10:20", "10:40", "11:00", "11:20"]
  return (
    <div
      data-demo
      role="img"
      aria-label="Agenda do dia com a lista de profissionais ao lado e os atendimentos de cada barbeiro em colunas, sem horários sobrepostos."
      className="overflow-hidden rounded-card border border-border bg-card text-foreground shadow-sm"
    >
      <WindowBar title="Agenda de hoje" />
      <div className="grid md:grid-cols-[220px_minmax(0,1fr)]">
        <ul className="hidden divide-y divide-border border-r border-border md:block">
          {BARBERS.map((barber, index) => (
            <li key={barber.name} className={cn("px-4 py-3", index === 0 && "bg-surface-alt")}>
              <span className="block text-sm font-semibold">{barber.name}</span>
              <span className="block text-[13px] text-muted-foreground">{barber.count}</span>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-[48px_repeat(2,minmax(0,1fr))] gap-x-2 p-3 sm:grid-cols-[56px_repeat(2,minmax(0,1fr))] sm:gap-x-3 sm:p-4">
          <span />
          <span className="pb-2 text-[13px] font-semibold">Barbeiro 1</span>
          <span className="pb-2 text-[13px] font-semibold">Barbeiro 2</span>
          <ol className="grid grid-rows-[repeat(8,minmax(40px,1fr))] gap-1 text-[13px] text-muted-foreground tabular-nums">
            {hours.map((hour) => (
              <li key={hour}>{hour}</li>
            ))}
          </ol>
          {COLUMNS.map((column, index) => (
            <ol key={index} className="grid grid-rows-[repeat(8,minmax(40px,1fr))] gap-1">
              {column.map((slot) => (
                <li
                  key={`${slot.start}-${slot.title}`}
                  style={{ gridRow: `${slot.start} / span ${slot.span}` }}
                  className={cn("min-w-0 overflow-hidden rounded-sm border px-2 py-1 text-[13px]", TONES[slot.tone])}
                >
                  <span className="block truncate font-semibold">{slot.title}</span>
                  {slot.span > 1 && <span className="block truncate text-muted-foreground">{slot.detail}</span>}
                </li>
              ))}
            </ol>
          ))}
        </div>
      </div>
    </div>
  )
}
