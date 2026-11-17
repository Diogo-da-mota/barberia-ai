import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronRight, Plus, Repeat, Search, X } from "lucide-react"
import { formatPrice } from "@/features/catalog/domain"
import type { MyBarbershop } from "@/features/home/domain"
import { addDays, formatDay, formatMonth, isMissingSchema, monthGrid, todayIn } from "@/features/booking/domain"
import { cn } from "@/lib/utils"
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/ui/alert-dialog"
import { Button } from "@/ui/button"
import { formatDateBR } from "@/ui/date-time"
import { EmptyState, StatusBadge } from "@/ui/finance"
import { Input } from "@/ui/input"
import { OptionSelect } from "@/ui/option-select"
import { toast } from "@/ui/sonner"
import { endExpenseRecurrence, fetchExpenseBook, type ExpenseEntry, type ExpenseRecurrence } from "../api"
import { EXPENSE_BADGE, expenseFormLabel, expenseFrequencyLabel, expenseTotals, expenseView, financeErrorMessage } from "../domain"
import { sumByKey } from "../summary"
import { ExpenseDetailDialog, ExpenseDialog, PayExpenseDialog } from "./ExpenseDialogs"
import { FIELD, Loading, Metric, QueryError, Section, Segmented, ShareBars } from "./FinanceUI"

type Filter = "todas" | "abertas" | "vencidas" | "pagas"
const FILTERS: { value: Filter; label: string }[] = [{ value: "todas", label: "Todas" }, { value: "abertas", label: "A pagar" }, { value: "vencidas", label: "Vencidas" }, { value: "pagas", label: "Pagas" }]
const EMPTY: Record<Filter, { title: string; description: string }> = {
  todas: { title: "Nenhuma despesa neste mês", description: "Cadastre aluguel, energia, produtos e outras contas em Nova despesa para acompanhar os vencimentos." },
  abertas: { title: "Nenhuma conta a pagar neste mês", description: "As contas pendentes com vencimento neste mês aparecem aqui." },
  vencidas: { title: "Nenhuma conta vencida neste mês", description: "Contas deste mês que passarem do vencimento sem pagamento aparecem aqui." },
  pagas: { title: "Nenhuma conta paga neste mês", description: "As contas deste mês marcadas como pagas aparecem aqui." },
}
/** Cor do dia no calendário: vencida > a pagar > tudo pago (ou lançamento antigo). */
const DAY_TONE = { vencida: "border-expense/40 bg-expense/10 text-expense", pendente: "border-primary/30 bg-primary/10", paga: "border-income/30 bg-income/10 text-income" } as const
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const ALL = "todas"
const MAX_AHEAD_DAYS = 731 // mesmo limite da migration 0030

/** Clicar na conta abre os detalhes; de lá saem Editar, Marcar como paga e Reverter pagamento. */
type Open = { kind: "nova" } | { kind: "detalhe" | "editar" | "pagar"; entry: ExpenseEntry }

/** Despesas de UM mês: contas com vencimento de 1º ao último dia do mês escolhido no cabeçalho. */
export function ExpensesTab({ shop, range }: { shop: MyBarbershop; range: { de: string; ate: string } }) {
  const queryClient = useQueryClient()
  const today = todayIn(shop.fuso ?? "America/Sao_Paulo")
  const book = useQuery({ queryKey: ["expenses", shop.id, "contas", range.de, range.ate], queryFn: () => fetchExpenseBook(shop.id, range.de, range.ate) })
  const [filter, setFilter] = useState<Filter>("todas")
  const [category, setCategory] = useState(ALL)
  const [search, setSearch] = useState("")
  const [view, setView] = useState<"lista" | "calendario">("lista")
  const [picked, setPicked] = useState<string | null>(null)
  const [open, setOpen] = useState<Open | null>(null)
  const [ending, setEnding] = useState<ExpenseRecurrence | null>(null)
  const day = picked && picked >= range.de && picked <= range.ate ? picked : null // trocar de mês desfaz o dia escolhido
  // a tela só muda depois de reler o banco: nada de situação "otimista"
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["expenses", shop.id] }), queryClient.invalidateQueries({ queryKey: ["finance-report", shop.id] })])
  const end = useMutation({
    mutationFn: (id: string) => endExpenseRecurrence(id),
    onSuccess: async () => { await refresh(); toast.success("Recorrência encerrada. As contas pagas e vencidas foram mantidas.") },
    onError: (e) => toast.error(financeErrorMessage(e)),
  })

  const entries = book.data?.entries
  const totals = useMemo(() => expenseTotals(entries ?? [], today), [entries, today])
  const categories = useMemo(() => [...new Set((entries ?? []).map((e) => e.categoria))].sort((a, b) => a.localeCompare(b, "pt-BR")), [entries])
  const byCategory = useMemo(() => sumByKey((entries ?? []).map((e) => ({ key: e.categoria, cents: e.valor_pago_centavos ?? e.valor_centavos }))), [entries])
  /** Situação de cada dia do mês, para o calendário (sempre o mês inteiro, sem filtros). */
  const days = useMemo(() => {
    const map = new Map<string, { count: number; tone: keyof typeof DAY_TONE }>()
    for (const e of entries ?? []) {
      const v = expenseView(e, today)
      const d = map.get(e.data) ?? { count: 0, tone: "paga" as keyof typeof DAY_TONE }
      map.set(e.data, { count: d.count + 1, tone: v === "vencida" || d.tone === "vencida" ? "vencida" : v === "pendente" || d.tone === "pendente" ? "pendente" : "paga" })
    }
    return map
  }, [entries, today])
  /** Contas filtradas, agrupadas por vencimento, do dia mais antigo para o mais novo: cada grupo vira um card. */
  const groups = useMemo(() => {
    const map = new Map<string, ExpenseEntry[]>()
    const q = search.trim().toLocaleLowerCase("pt-BR")
    for (const e of entries ?? []) {
      if (q && !e.descricao.toLocaleLowerCase("pt-BR").includes(q)) continue
      const v = expenseView(e, today)
      if (day && e.data !== day) continue
      if (category !== ALL && e.categoria !== category) continue
      if ((filter === "abertas" && e.situacao !== "pendente") || (filter === "vencidas" && v !== "vencida") || (filter === "pagas" && e.situacao !== "paga")) continue
      map.set(e.data, [...(map.get(e.data) ?? []), e])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [entries, day, category, filter, search, today])

  if (book.isError) {
    return isMissingSchema(book.error)
      ? <EmptyState title="Despesas ainda não disponíveis" description="O controle de contas a pagar depende de uma atualização do banco de dados (0029) que ainda não foi aplicada." />
      : <QueryError error={book.error} onRetry={() => void book.refetch()} />
  }
  if (!book.data) return <Loading label="Carregando despesas" />
  const { recurrences } = book.data
  const month = formatMonth(range.de)
  const suggested = day ?? (today >= range.de && today <= range.ate ? today : range.de)
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric lead label="Total do mês" value={totals.total.cents} hint={totals.total.count ? plural(totals.total.count, "conta", "contas") + (totals.antigas.count ? ` · ${formatPrice(totals.antigas.cents)} em lançamentos antigos` : "") : "Nenhuma conta neste mês"} />
        <Metric label="Falta pagar" value={totals.falta.cents} tone={totals.falta.count ? "warning" : undefined} hint={totals.previstas.count ? `${formatPrice(totals.previstas.cents)} em valores previstos` : totals.falta.count ? plural(totals.falta.count, "conta em aberto", "contas em aberto") : "Nada em aberto"} />
        <Metric label="Já pagas" value={totals.pagas.cents} tone={totals.pagas.count ? "income" : undefined} hint={totals.pagas.count ? plural(totals.pagas.count, "conta paga", "contas pagas") : "Nenhuma conta paga"} />
        <Metric label="Vencidas" value={totals.vencidas.cents} tone={totals.vencidas.count ? "expense" : undefined} hint={totals.vencidas.count ? plural(totals.vencidas.count, "conta vencida", "contas vencidas") : "Nenhuma conta vencida"} />
      </div>

      <div className="xl:hidden"><Segmented label="Visualização" value={view} onChange={setView} options={[{ value: "lista", label: "Lista" }, { value: "calendario", label: "Calendário" }]} /></div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Coluna das contas: um card com os filtros e, abaixo, UM CARD POR DATA de vencimento (todas as contas do dia juntas). */}
        <div className={cn("flex min-w-0 flex-col gap-3 self-start", view === "calendario" && "hidden xl:flex")}>
        <Section
          title={`Contas de ${month.toLowerCase()}`}
          description="Vencimentos de 1º ao último dia do mês, em ordem de data."
          action={<Button className="h-11 gap-2 md:h-10" onClick={() => setOpen({ kind: "nova" })}><Plus className="h-4 w-4" aria-hidden="true" />Nova despesa</Button>}
        >
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input type="search" aria-label="Buscar despesa pela descrição" placeholder="Buscar pela descrição" value={search} onChange={(e) => setSearch(e.target.value)} className={cn(FIELD, "pl-9")} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="max-w-full overflow-x-auto"><Segmented label="Situação" value={filter} onChange={setFilter} options={FILTERS} /></div>
            {categories.length > 1 && <OptionSelect aria-label="Categoria" className="w-full sm:w-52" value={category} onValueChange={setCategory} options={[{ value: ALL, label: "Todas as categorias" }, ...categories.map((c) => ({ value: c, label: c }))]} />}
            {day && <Button variant="outline" className="h-11 gap-2 md:h-10" onClick={() => setPicked(null)}><X className="h-4 w-4" aria-hidden="true" />Só {formatDateBR(day).slice(0, 5)} · ver o mês todo</Button>}
          </div>
          {groups.length === 0 && <div className="mt-4"><EmptyState {...(search.trim() ? { title: "Nenhuma despesa encontrada", description: `Nenhuma conta deste mês tem “${search.trim()}” na descrição.` } : day ? { title: "Nenhuma conta neste dia", description: `Não há contas com vencimento em ${formatDateBR(day)} para o filtro escolhido.` } : EMPTY[filter])} /></div>}
          {recurrences.length > 0 && range.de > addDays(today, MAX_AHEAD_DAYS) && <p className="mt-4 text-sm text-muted-foreground">As contas recorrentes são criadas até 24 meses à frente; este mês ainda não as mostra.</p>}
        </Section>
              {groups.map(([date, items]) => (
                <section key={date} aria-label={formatDay(date)} className={cn("overflow-hidden rounded-card border bg-card", date === today ? "border-primary/40" : "border-border")}>
                  <h3 className="flex items-baseline justify-between gap-3 border-b border-border bg-surface-alt px-4 py-2.5 text-sm font-semibold sm:px-5">
                    <span>{formatDay(date)}{date === today && <span className="text-primary"> · hoje</span>}</span>
                    <span className="tabular-nums text-muted-foreground">{items.length > 1 && `${items.length} contas · `}{formatPrice(items.reduce((t, e) => t + (e.valor_pago_centavos ?? e.valor_centavos), 0))}</span>
                  </h3>
                  <ul className="divide-y divide-border px-4 py-1 sm:px-5">
                    {items.map((e) => {
                      const v = expenseView(e, today)
                      const [variant, label] = EXPENSE_BADGE[v]
                      const meta = [e.categoria, v === "paga" ? `Paga em ${formatDateBR(e.pago_em!)}` : null, e.forma ? expenseFormLabel(e.forma) : null, v === "pendente" && e.recurrence_id ? "Valor previsto" : null].filter(Boolean).join(" · ")
                      return (
                        <li key={e.id}>
                          <button type="button" onClick={() => setOpen({ kind: "detalhe", entry: e })}
                            className="-mx-2 grid w-[calc(100%+1rem)] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                            <span className="min-w-0">
                              <span className="flex items-center gap-2 text-base font-medium">
                                <span className="truncate">{e.descricao}</span>
                                {e.recurrence_id && <Repeat className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Despesa recorrente" />}
                              </span>
                              <span className="block truncate text-sm text-muted-foreground">{meta}</span>
                            </span>
                            <span className="flex flex-col items-end gap-1">
                              <span className="font-display font-semibold tabular-nums">{formatPrice(e.valor_pago_centavos ?? e.valor_centavos)}</span>
                              <StatusBadge variant={variant}>{label}</StatusBadge>
                            </span>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
        </div>

        <div className={cn("flex min-w-0 flex-col gap-4 self-start", view === "lista" && "hidden xl:flex")}>
          <Section title={month} description="Toque em um dia para ver as contas que vencem nele.">
            <div className="grid grid-cols-7 gap-1 text-center text-[13px] text-muted-foreground" aria-hidden="true">
              {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => <span key={d}>{d}</span>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {monthGrid(range.de).map((d, i) => {
                if (!d) return <span key={`v${i}`} />
                const info = days.get(d)
                return (
                  <button key={d} type="button" aria-pressed={day === d} onClick={() => { setPicked(day === d ? null : d); setView("lista") }}
                    aria-label={`${formatDay(d)}, ${info ? plural(info.count, "conta", "contas") : "sem contas"}`}
                    className={cn("flex min-h-12 flex-col items-center justify-center rounded-md border text-sm tabular-nums transition-colors hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      info ? DAY_TONE[info.tone] : "border-border", d === today && "border-primary", day === d && "ring-2 ring-primary")}>
                    {Number(d.slice(8))}
                    {info && <span className="text-[11px] font-semibold">{info.count}</span>}
                  </button>
                )
              })}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {([["pendente", "A pagar"], ["vencida", "Vencida"], ["paga", "Pago"]] as const).map(([tone, text]) => (
                <li key={tone} className="flex items-center gap-1.5"><span aria-hidden="true" className={cn("h-3 w-3 rounded border", DAY_TONE[tone])} />{text}</li>
              ))}
            </ul>
          </Section>
          {byCategory.length > 0 && <Section title="Por categoria" description="Contas com vencimento neste mês."><ShareBars items={byCategory} tone="expense" /></Section>}
          {recurrences.length > 0 && (
            <Section title="Despesas recorrentes" description="Criam a conta de cada mês sozinhas. Encerrar não apaga o que já foi pago ou venceu.">
              <ul className="divide-y divide-border">
                {recurrences.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-base font-medium">{r.descricao}</p>
                      <p className="text-sm text-muted-foreground">{expenseFrequencyLabel(r.frequencia)} · {formatPrice(r.valor_centavos)}</p>
                    </div>
                    <Button variant="outline" className="h-11 shrink-0 md:h-9" disabled={end.isPending} onClick={() => setEnding(r)}>Encerrar</Button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>

      {open?.kind === "detalhe" && <ExpenseDetailDialog entry={open.entry} today={today} tz={shop.fuso ?? "America/Sao_Paulo"} onClose={() => setOpen(null)} onSaved={refresh} onPay={() => setOpen({ kind: "pagar", entry: open.entry })} onEdit={() => setOpen({ kind: "editar", entry: open.entry })} />}
      {open?.kind === "pagar" && <PayExpenseDialog entry={open.entry} today={today} onClose={() => setOpen(null)} onSaved={refresh} />}
      {(open?.kind === "nova" || open?.kind === "editar") && <ExpenseDialog shopId={shop.id} today={today} range={range} suggestedDate={suggested} entry={open.kind === "editar" ? open.entry : undefined} categories={categories} onClose={() => setOpen(null)} onSaved={refresh} />}
      <AlertDialog open={Boolean(ending)} onOpenChange={(o) => !o && setEnding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar esta recorrência?</AlertDialogTitle>
            <AlertDialogDescription>{ending ? `“${ending.descricao}” deixa de criar novas contas e as que ainda vão vencer são removidas. As contas pagas, as vencidas e a de hoje continuam na lista.` : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" className="h-11 md:h-10" onClick={() => setEnding(null)}>Cancelar</Button>
            <Button className="h-11 md:h-10" onClick={() => { if (ending) end.mutate(ending.id); setEnding(null) }}>Encerrar recorrência</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
