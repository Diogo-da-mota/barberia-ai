import { useState } from "react"
import { CalendarDays, Clock } from "lucide-react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Calendar } from "./calendar"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { Button } from "./button"
import { cn } from "@/lib/utils"

/**
 * Campos de data e hora (shadcn: Popover + Calendar). Clicar abre o seletor; nada de digitar no formato do navegador.
 * Valores no mesmo formato dos inputs nativos: data "AAAA-MM-DD", mês "AAAA-MM", hora "HH:MM", data e hora "AAAA-MM-DDTHH:MM".
 */
const TRIGGER = "flex h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-base tabular-nums transition-colors hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:text-sm"
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
const pad = (n: number) => String(n).padStart(2, "0")

export const parseDate = (value: string): Date | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined
}
export const toDateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const formatDateBR = (value: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value); return m ? `${m[3]}/${m[2]}/${m[1]}` : "" }
export const formatMonthBR = (value: string) => { const m = /^(\d{4})-(\d{2})$/.exec(value); return m ? `${MONTHS[Number(m[2]) - 1]} de ${m[1]}` : "" }

type Common = { id?: string; className?: string; disabled?: boolean; "aria-label"?: string; placeholder?: string }

/** Data: calendário em pop-up. */
export function DateField({ value, onChange, placeholder = "Selecionar data", className, ...rest }: Common & { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const selected = parseDate(value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" id={rest.id} aria-label={rest["aria-label"]} disabled={rest.disabled} className={cn(TRIGGER, className)}>
          <span className={cn(!selected && "text-muted-foreground")}>{selected ? formatDateBR(value) : placeholder}</span>
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <Calendar mode="single" selected={selected} defaultMonth={selected} onSelect={(d) => { if (d) { onChange(toDateValue(d)); setOpen(false) } }} />
      </PopoverContent>
    </Popover>
  )
}

/** Mês e ano: grade de meses com troca de ano. */
export function MonthField({ value, onChange, placeholder = "Selecionar mês", className, ...rest }: Common & { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(() => Number(value.slice(0, 4)) || new Date().getFullYear())
  const current = /^(\d{4})-(\d{2})$/.test(value) ? { y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) } : null
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o && current) setYear(current.y) }}>
      <PopoverTrigger asChild>
        <button type="button" id={rest.id} aria-label={rest["aria-label"]} disabled={rest.disabled} className={cn(TRIGGER, className)}>
          <span className={cn("inline-block first-letter:uppercase", !current && "text-muted-foreground")}>{current ? formatMonthBR(value) : placeholder}</span>
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3">
        <div className="mb-3 flex items-center justify-between">
          <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="Ano anterior" onClick={() => setYear(year - 1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
          <span className="font-display text-base font-semibold tabular-nums">{year}</span>
          <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="Próximo ano" onClick={() => setYear(year + 1)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {MONTHS.map((name, i) => {
            const active = current?.y === year && current.m === i + 1
            return (
              <button
                key={name} type="button" aria-pressed={active}
                onClick={() => { onChange(`${year}-${pad(i + 1)}`); setOpen(false) }}
                className={cn("h-10 rounded-md border text-sm font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-surface-alt")}
              >
                {name.slice(0, 3)}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TimeColumns({ value, onChange, step }: { value: string; onChange: (value: string) => void; step: number }) {
  const [h, m] = /^(\d{2}):(\d{2})/.test(value) ? [Number(value.slice(0, 2)), Number(value.slice(3, 5))] : [null, null]
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step)
  if (m !== null && !minutes.includes(m)) minutes.push(m)
  minutes.sort((a, b) => a - b)
  const col = "flex max-h-56 w-16 flex-col gap-1 overflow-y-auto p-1 [scrollbar-width:thin]"
  const cell = (active: boolean) => cn("h-9 shrink-0 rounded-md text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", active ? "bg-primary text-primary-foreground" : "hover:bg-surface-alt")
  return (
    <div className="flex gap-2">
      <div role="listbox" aria-label="Hora" className={col}>
        {Array.from({ length: 24 }, (_, i) => (
          <button key={i} type="button" role="option" aria-selected={h === i} className={cell(h === i)} onClick={() => onChange(`${pad(i)}:${pad(m ?? 0)}`)}>{pad(i)}</button>
        ))}
      </div>
      <div role="listbox" aria-label="Minutos" className={col}>
        {minutes.map((i) => (
          <button key={i} type="button" role="option" aria-selected={m === i} className={cell(m === i)} onClick={() => onChange(`${pad(h ?? 9)}:${pad(i)}`)}>{pad(i)}</button>
        ))}
      </div>
    </div>
  )
}

/** Hora: duas colunas (hora e minutos). */
export function TimeField({ value, onChange, step = 5, placeholder = "--:--", clearable = false, className, ...rest }: Common & { value: string; onChange: (value: string) => void; step?: number; clearable?: boolean }) {
  const [open, setOpen] = useState(false)
  const has = /^\d{2}:\d{2}/.test(value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" id={rest.id} aria-label={rest["aria-label"]} disabled={rest.disabled} className={cn(TRIGGER, className)}>
          <span className={cn(!has && "text-muted-foreground")}>{has ? value.slice(0, 5) : placeholder}</span>
          <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-2">
        <TimeColumns value={value} onChange={onChange} step={step} />
        <div className="mt-2 flex gap-2">
          {clearable && <Button type="button" variant="outline" className="h-9 flex-1" onClick={() => { onChange(""); setOpen(false) }}>Limpar</Button>}
          <Button type="button" className="h-9 flex-1" onClick={() => setOpen(false)}>OK</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Data e hora: calendário e horário no mesmo pop-up. Com `name`, envia o valor em formulários. */
export function DateTimeField({ value, onChange, name, step = 5, placeholder = "Selecionar data e hora", className, ...rest }: Common & { value: string; onChange: (value: string) => void; name?: string; step?: number }) {
  const [open, setOpen] = useState(false)
  const date = value.slice(0, 10)
  const time = value.slice(11, 16)
  const selected = parseDate(date)
  const label = selected ? `${formatDateBR(date)} ${time || "00:00"}` : placeholder
  return (
    <>
      {name && <input type="hidden" name={name} value={value} />}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" id={rest.id} aria-label={rest["aria-label"]} disabled={rest.disabled} className={cn(TRIGGER, className)}>
            <span className={cn(!selected && "text-muted-foreground")}>{label}</span>
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-0">
          <div className="flex flex-col sm:flex-row">
            <Calendar mode="single" selected={selected} defaultMonth={selected} onSelect={(d) => { if (d) onChange(`${toDateValue(d)}T${time || "09:00"}`) }} />
            <div className="border-t border-border p-2 sm:border-l sm:border-t-0">
              <p className="px-1 pb-1 text-[13px] font-medium text-muted-foreground">Horário</p>
              <TimeColumns value={time} onChange={(t) => onChange(`${date || toDateValue(new Date())}T${t}`)} step={step} />
            </div>
          </div>
          <div className="border-t border-border p-2"><Button type="button" className="h-9 w-full" onClick={() => setOpen(false)}>OK</Button></div>
        </PopoverContent>
      </Popover>
    </>
  )
}
