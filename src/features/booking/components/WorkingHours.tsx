import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { TimeField } from "@/ui/date-time"
import { EmptyState } from "@/ui/finance"
import { Skeleton } from "@/ui/skeleton"
import { toast } from "@/ui/sonner"
import { fetchWorkingHours, saveWorkingHours, type HoursInterval } from "../api"
import { bookingErrorMessage, isMissingSchema } from "../domain"

export const DAYS = [
  { dow: 1, nome: "Segunda-feira" }, { dow: 2, nome: "Terça-feira" }, { dow: 3, nome: "Quarta-feira" }, { dow: 4, nome: "Quinta-feira" },
  { dow: 5, nome: "Sexta-feira" }, { dow: 6, nome: "Sábado" }, { dow: 0, nome: "Domingo" },
]

export type DayForm = { a1: string; a2: string; b1: string; b2: string }
const empty: DayForm = { a1: "", a2: "", b1: "", b2: "" }
const toTime = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`
const toMin = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

/** Dia sem almoço vem do banco como um único intervalo: abre em a1 e fecha em b2 (forma canônica da tela). */
export function toForm(intervals: HoursInterval[]): Record<number, DayForm> {
  const form: Record<number, DayForm> = {}
  for (const { dow } of DAYS) {
    const day = intervals.filter((i) => i.dow === dow).sort((a, b) => a.inicio_min - b.inicio_min)
    form[dow] = day.length === 1
      ? { a1: toTime(day[0].inicio_min), a2: "", b1: "", b2: toTime(day[0].fim_min) }
      : { a1: day[0] ? toTime(day[0].inicio_min) : "", a2: day[0] ? toTime(day[0].fim_min) : "", b1: day[1] ? toTime(day[1].inicio_min) : "", b2: day[1] ? toTime(day[1].fim_min) : "" }
  }
  return form
}

/**
 * Converte o formulário em intervalos. Colunas: abre · fecha pro almoço · abre pro almoço · fecha.
 * O almoço é opcional: sem nenhum dos dois campos do almoço, o dia vai de "abre" até "fecha".
 */
export function toIntervals(form: Record<number, DayForm>): { intervals: HoursInterval[]; error?: string } {
  const intervals: HoursInterval[] = []
  for (const { dow, nome } of DAYS) {
    const d = form[dow] ?? empty
    if (!d.a1 && !d.a2 && !d.b1 && !d.b2) continue // folga
    // sem almoço, de duas formas: só abre e fecha (nos campos de abrir e fechar), ou abre e fecha
    // nos campos do almoço (fecha pro almoço = fechamento do dia, sem volta)
    if (!d.a2 && !d.b1) {
      if (!d.a1) return { intervals, error: `${nome}: preencha o horário em que abre.` }
      if (!d.b2) return { intervals, error: `${nome}: preencha o horário em que fecha.` }
      if (toMin(d.a1) >= toMin(d.b2)) return { intervals, error: `Confira os horários de ${nome}.` }
      intervals.push({ dow, inicio_min: toMin(d.a1), fim_min: toMin(d.b2) })
      continue
    }
    if (!d.b1 && !d.b2) {
      if (!d.a1) return { intervals, error: `${nome}: preencha o horário em que abre.` }
      if (toMin(d.a1) >= toMin(d.a2)) return { intervals, error: `Confira os horários de ${nome}.` }
      intervals.push({ dow, inicio_min: toMin(d.a1), fim_min: toMin(d.a2) })
      continue
    }
    // com almoço: os quatro horários são obrigatórios
    if (d.a1 && d.a2 && toMin(d.a1) >= toMin(d.a2)) return { intervals, error: `Confira os horários de ${nome}.` }
    if (!d.a1) return { intervals, error: `${nome}: preencha o horário em que abre.` }
    if (!d.a2) return { intervals, error: `${nome}: preencha o horário em que sai para o almoço, ou apague o almoço.` }
    if (!d.b1) return { intervals, error: `${nome}: preencha o horário em que volta do almoço, ou apague o almoço.` }
    if (!d.b2) return { intervals, error: `${nome}: preencha o horário em que fecha.` }
    const [a1, a2, b1, b2] = [d.a1, d.a2, d.b1, d.b2].map(toMin)
    if (a1 >= a2 || b1 >= b2 || a2 > b1) return { intervals, error: `Confira os horários de ${nome}.` }
    intervals.push({ dow, inicio_min: a1, fim_min: a2 }, { dow, inicio_min: b1, fim_min: b2 })
  }
  return { intervals }
}


const DAY_LABEL: Record<number, string> = { 1: "Segunda", 2: "Terça", 3: "Quarta", 4: "Quinta", 5: "Sexta", 6: "Sábado", 0: "Domingo" }
const isOn = (d: DayForm) => Boolean(d.a1 || d.a2 || d.b1 || d.b2)
const hasLunch = (d: DayForm) => Boolean(d.a2 && d.b1)

/** Colunas da grade (desktop): dia · abre · fecha · almoço · sai · volta. No celular cada dia vira um bloco. */
const COLS = "sm:grid-cols-[150px_100px_100px_72px_100px_100px]"

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cn("relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", checked ? "border-primary bg-primary" : "border-border bg-surface-alt")}
    >
      <span className={cn("absolute top-0.5 left-0 h-4 w-4 rounded-full shadow transition-transform", checked ? "translate-x-[22px] bg-primary-foreground" : "translate-x-0.5 bg-muted-foreground")} />
    </button>
  )
}

/** Campo de hora com rótulo só no celular (no desktop o cabeçalho da grade faz esse papel). */
function Slot({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span aria-hidden="true" className="text-[11px] font-medium text-muted-foreground sm:hidden">{label}</span>
      {children}
    </div>
  )
}

/**
 * Jornada semanal de UM profissional, dentro da edição dele (Equipe): uma grade compacta, uma linha por dia.
 * Interruptor liga o dia (desligado = folga), o almoço é opcional. A regra de gravação é `toIntervals`.
 */
export function WorkingHoursEditor({ professionalId }: { professionalId: string }) {
  const queryClient = useQueryClient()
  const hours = useQuery({ queryKey: ["working-hours", professionalId], queryFn: () => fetchWorkingHours(professionalId) })
  const [form, setForm] = useState<Record<number, DayForm> | null>(null)
  const [onState, setOnState] = useState<Record<number, boolean> | null>(null)
  const [lunchState, setLunchState] = useState<Record<number, boolean> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const values = form ?? (hours.data ? toForm(hours.data) : null)
  // "atende" e "almoço" são escolhas da tela (campos vazios não perdem o estado); começam do que está salvo
  const initial = (pick: (d: DayForm) => boolean) => (values ? Object.fromEntries(DAYS.map(({ dow }) => [dow, pick(values[dow] ?? empty)])) as Record<number, boolean> : null)
  const onMap = onState ?? initial(isOn)
  const lunchMap = lunchState ?? initial(hasLunch)

  const save = useMutation({
    mutationFn: (intervals: HoursInterval[]) => saveWorkingHours(professionalId, intervals),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["working-hours", professionalId] }), queryClient.invalidateQueries({ queryKey: ["slots"] })])
      toast.success("Horários salvos.")
    },
    onError: (e) => setError(bookingErrorMessage(e)),
  })

  if (isMissingSchema(hours.error)) return <EmptyState title="Horários indisponíveis" description="O agendamento ainda está sendo preparado no banco de dados." />
  if (hours.isError) return <p role="alert" className="text-sm text-danger">Não foi possível carregar os horários.</p>
  if (!values || !onMap || !lunchMap) return <div role="status" aria-label="Carregando horários"><Skeleton className="h-48 w-full" /></div>

  const patch = (dow: number, next: Partial<DayForm>) => setForm({ ...values, [dow]: { ...(values[dow] ?? empty), ...next } })
  // os horários começam VAZIOS: quem escolhe é o usuário
  const setDay = (dow: number, on: boolean) => {
    setOnState({ ...onMap, [dow]: on })
    if (!on) { patch(dow, empty); setLunchState({ ...lunchMap, [dow]: false }) }
  }
  const setLunch = (dow: number, on: boolean) => {
    setLunchState({ ...lunchMap, [dow]: on })
    if (!on) patch(dow, { a2: "", b1: "" })
  }
  const copyMonday = () => {
    const monday = values[1] ?? empty
    const days = [2, 3, 4, 5]
    setForm({ ...values, ...Object.fromEntries(days.map((dow) => [dow, { ...monday }])) })
    setOnState({ ...onMap, ...Object.fromEntries(days.map((dow) => [dow, onMap[1]])) })
    setLunchState({ ...lunchMap, ...Object.fromEntries(days.map((dow) => [dow, lunchMap[1]])) })
  }
  const onSave = () => {
    const payload: Record<number, DayForm> = {}
    for (const { dow, nome } of DAYS) {
      const d = values[dow] ?? empty
      if (!onMap[dow]) { payload[dow] = empty; continue }
      if (!d.a1 && !d.b2 && !d.a2 && !d.b1) { setError(`${nome}: escolha o horário em que abre e em que fecha, ou desligue o dia.`); return }
      if (lunchMap[dow] && (!d.a2 || !d.b1)) { setError(`${nome}: escolha a saída e a volta do almoço, ou desmarque o almoço.`); return }
      payload[dow] = d
    }
    const { intervals, error: found } = toIntervals(payload)
    setError(found ?? null)
    if (!found) save.mutate(intervals)
  }
  const daysOn = DAYS.filter(({ dow }) => onMap[dow]).length
  const time = (dow: number, nome: string, key: keyof DayForm, label: string) => (
    <TimeField step={15} aria-label={`${nome}, ${label}`} value={values[dow]?.[key] ?? ""} onChange={(v) => patch(dow, { [key]: v })} className="h-10 w-full px-3 md:h-10" />
  )

  return (
    <section aria-label="Horários de atendimento" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Ligue os dias em que atende. No almoço não há reservas.</p>
        <Button type="button" variant="outline" className="h-9 gap-1.5 rounded-lg px-3 text-sm" onClick={copyMonday} disabled={!onMap[1]}>
          <Copy className="h-4 w-4" aria-hidden="true" />
          Copiar segunda para seg–sex
        </Button>
      </div>
      {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <div className={cn("hidden gap-3 px-3 text-xs font-medium tracking-wider text-muted-foreground uppercase sm:grid", COLS)} aria-hidden="true">
        <span>Dia</span><span>Abre</span><span>Fecha</span><span>Almoço</span><span>Sai</span><span>Volta</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {DAYS.map(({ dow, nome }) => {
          const on = onMap[dow]
          const lunch = lunchMap[dow]
          return (
            <li key={dow} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2 sm:grid sm:items-center", COLS, on ? "border-border bg-surface-alt/50" : "border-transparent")}>
              <div className="flex w-full items-center gap-3 sm:w-auto">
                <Switch checked={on} onChange={(v) => setDay(dow, v)} label={`${nome}: atende`} />
                <span className={cn("font-display text-base leading-6 font-semibold tracking-wide", !on && "text-muted-foreground")}>{DAY_LABEL[dow]}</span>
              </div>
              {on ? (
                <>
                  <Slot label="Abre" className="w-[calc(50%-0.375rem)] sm:w-auto">{time(dow, nome, "a1", "abre")}</Slot>
                  <Slot label="Fecha" className="w-[calc(50%-0.375rem)] sm:w-auto">{time(dow, nome, "b2", "fecha")}</Slot>
                  <label className="flex h-10 w-full cursor-pointer items-center gap-2 text-sm sm:w-auto">
                    <input type="checkbox" checked={lunch} onChange={(e) => setLunch(dow, e.target.checked)} aria-label={`${nome}: tem almoço`} className="h-5 w-5 accent-primary" />
                    <span className="sm:sr-only">Almoço</span>
                  </label>
                  {lunch ? (
                    <>
                      <Slot label="Sai para o almoço" className="w-[calc(50%-0.375rem)] sm:w-auto">{time(dow, nome, "a2", "sai para o almoço")}</Slot>
                      <Slot label="Volta do almoço" className="w-[calc(50%-0.375rem)] sm:w-auto">{time(dow, nome, "b1", "volta do almoço")}</Slot>
                    </>
                  ) : (
                    <span aria-hidden="true" className="hidden text-sm text-muted-foreground sm:col-span-2 sm:block">sem pausa</span>
                  )}
                </>
              ) : (
                <span className="text-sm text-muted-foreground sm:col-span-5">Folga</span>
              )}
            </li>
          )
        })}
      </ul>

      {/* barra de salvar fixa no rodapé do pop-up: o botão nunca fica escondido pela rolagem */}
      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-1 flex items-center justify-between gap-3 border-t border-border bg-card/95 px-6 py-3 backdrop-blur">
        <p className="text-sm text-muted-foreground">{daysOn === 0 ? "Nenhum dia ligado" : `${daysOn} ${daysOn === 1 ? "dia" : "dias"} de atendimento`}</p>
        <Button type="button" className="h-11 md:h-10" disabled={save.isPending} onClick={onSave}>{save.isPending ? "Salvando…" : "Salvar horários"}</Button>
      </div>
    </section>
  )
}
