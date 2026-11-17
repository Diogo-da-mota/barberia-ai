import { useState, type FormEvent, type ReactNode } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Check, Copy, Pencil, Plus, Repeat, Trash2, Undo2 } from "lucide-react"
import { formatDateTime, formatMonth } from "@/features/booking/domain"
import { formatPrice } from "@/features/catalog/domain"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { DateField, formatDateBR } from "@/ui/date-time"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog"
import { Field, MoneyInput, StatusBadge } from "@/ui/finance"
import { Input } from "@/ui/input"
import { OptionSelect } from "@/ui/option-select"
import { toast } from "@/ui/sonner"
import { createExpense, createExpenses, deleteExpense, fetchExpenseEvents, payExpense, revertExpensePayment, updateExpense, updateExpenseDetails, type ExpenseEntry } from "../api"
import { EXPENSE_BADGE, EXPENSE_FORMS, EXPENSE_FREQUENCIES, expenseFormLabel, expenseView, financeErrorMessage, newKey, type ExpenseForm, type ExpenseFrequency } from "../domain"
import { FIELD } from "./FinanceUI"
import { PaymentFormIcon } from "./PaymentForm"

const SUGGESTED = ["Aluguel", "Energia", "Água", "Internet", "Produtos", "Manutenção", "Impostos", "Assinaturas"]
const FORM_OPTIONS = EXPENSE_FORMS.map((f) => ({ value: f.value, label: f.label, icon: <PaymentFormIcon form={f.value} className="h-4.5 w-4.5" /> }))
const NONE = "nenhuma"
const ONCE = "nao"
const MAX_LINES = 30 // mesmo limite de create_expenses (0031)

function Frame({ title, description, onClose, wide, children }: { title: string; description: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={cn("max-h-[92dvh] w-[calc(100%-2rem)] overflow-y-auto bg-card", wide ? "max-w-[820px]" : "max-w-[520px]")}>
        <div className="flex flex-col gap-1 pr-8 text-left">
          <DialogTitle className="font-display text-2xl font-bold tracking-wide">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  )
}

const Failure = ({ message }: { message: string | null }) => message && <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{message}</p>
const notPendingOrPaid = (e: unknown) => ["expense_not_pending", "expense_not_paid"].includes((e as { message?: string })?.message ?? "")

type Line = { id: string; descricao: string; categoria: string; valor: number | null; vencimento: string; frequencia: string; situacao: "pendente" | "paga"; pagoEm: string; forma: string; linha: string }
type LineErrors = Partial<Record<"descricao" | "categoria" | "valor" | "vencimento" | "forma" | "pagoEm", string>>
/** nova = todos os campos; pendente = edição de conta em aberto; detalhes = conta paga ou antiga (só descrição e categoria). */
type Mode = "nova" | "pendente" | "detalhes"

const isPaid = (l: Line) => l.frequencia === ONCE && l.situacao === "paga"
function validate(l: Line, today: string, mode: Mode): LineErrors {
  const e: LineErrors = {}
  if (!l.descricao.trim()) e.descricao = "Informe a descrição, como Energia elétrica."
  if (!l.categoria.trim()) e.categoria = "Informe a categoria."
  if (mode === "detalhes") return e
  if (!l.valor) e.valor = "Informe um valor maior que zero."
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.vencimento)) e.vencimento = "Escolha a data de vencimento."
  if (mode === "nova" && isPaid(l) && l.forma === NONE) e.forma = "Escolha como a despesa foi paga."
  if (mode === "nova" && isPaid(l) && l.pagoEm > today) e.pagoEm = "A data do pagamento não pode ser futura."
  return e
}
const toInput = (l: Line) => ({
  descricao: l.descricao.trim(), categoria: l.categoria.trim(), valor: l.valor!, vencimento: l.vencimento,
  forma: l.forma === NONE ? null : (l.forma as ExpenseForm), linha: l.forma === "boleto" && l.frequencia === ONCE && l.linha.trim() ? l.linha.trim() : null,
})
const toCreate = (l: Line) => ({ ...toInput(l), id: l.id, frequencia: l.frequencia === ONCE ? null : (l.frequencia as ExpenseFrequency), pagoEm: isPaid(l) ? l.pagoEm : null })

/** Campos de UMA despesa. Os ids levam o número da linha para os rótulos continuarem únicos no cadastro de várias. */
const OTHER = "__outra__"
/**
 * Categoria: lista suspensa igual às outras (categorias já usadas + sugestões). "Outra categoria…" troca a lista por um
 * campo de texto para digitar uma nova; "Escolher da lista" volta. Nada de lista nativa do navegador.
 */
function CategoryField({ id, value, categories, onChange }: { id: string; value: string; categories: string[]; onChange: (value: string) => void }) {
  const [typing, setTyping] = useState(false)
  const known = [...new Set([...categories, ...SUGGESTED, ...(value.trim() ? [value] : [])])].sort((a, b) => a.localeCompare(b, "pt-BR"))
  if (typing) {
    return (
      <div className="flex flex-col gap-1.5">
        <Input id={id} autoFocus value={value} maxLength={40} onChange={(e) => onChange(e.target.value)} className={FIELD} placeholder="Nome da nova categoria" />
        <button type="button" className="self-start text-sm font-medium text-link underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setTyping(false)}>Escolher da lista</button>
      </div>
    )
  }
  return (
    <OptionSelect id={id} value={value} placeholder="Selecionar" options={[...known.map((c) => ({ value: c, label: c })), { value: OTHER, label: "Outra categoria…" }]}
      onValueChange={(v) => { if (v === OTHER) { onChange(""); setTyping(true) } else onChange(v) }} />
  )
}

function LineFields({ n, line, errors, mode, categories, set }: { n: number; line: Line; errors: LineErrors; mode: Mode; categories: string[]; set: (patch: Partial<Line>) => void }) {
  const paid = mode === "nova" && isPaid(line)
  const id = (name: string) => `desp-${name}-${n}`
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <Field label="Descrição" htmlFor={id("desc")} required error={errors.descricao} className="sm:col-span-2"><Input id={id("desc")} value={line.descricao} maxLength={120} onChange={(e) => set({ descricao: e.target.value })} className={FIELD} placeholder="Ex.: conta de luz" /></Field>
      <Field label="Categoria" htmlFor={id("cat")} required error={errors.categoria} className={mode === "detalhes" ? "sm:col-span-2" : undefined}><CategoryField id={id("cat")} value={line.categoria} categories={categories} onChange={(categoria) => set({ categoria })} /></Field>
      {mode !== "detalhes" && <>
        <Field label="Valor (R$)" htmlFor={id("valor")} required error={errors.valor}><MoneyInput id={id("valor")} defaultCents={line.valor} onCentsChange={(valor) => set({ valor })} /></Field>
        <Field label={line.frequencia === ONCE ? "Vencimento" : "1º vencimento"} htmlFor={id("venc")} required error={errors.vencimento} className={mode === "pendente" ? "sm:col-span-2" : undefined}><DateField id={id("venc")} value={line.vencimento} onChange={(vencimento) => set({ vencimento })} /></Field>
        {mode === "nova" && <>
          <Field label="Repete" htmlFor={id("freq")}><OptionSelect id={id("freq")} value={line.frequencia} onValueChange={(frequencia) => set({ frequencia })} options={[{ value: ONCE, label: "Não repete" }, ...EXPENSE_FREQUENCIES]} /></Field>
          <Field label="Situação" htmlFor={id("sit")}><OptionSelect id={id("sit")} disabled={line.frequencia !== ONCE} value={line.frequencia === ONCE ? line.situacao : "pendente"} onValueChange={(v) => set({ situacao: v as Line["situacao"] })} options={[{ value: "pendente", label: "Pendente" }, { value: "paga", label: "Já paga" }]} /></Field>
        </>}
        <Field label={paid ? "Forma de pagamento" : "Forma prevista"} htmlFor={id("forma")} required={paid} error={errors.forma} className={mode === "pendente" ? "sm:col-span-2" : undefined}>
          <OptionSelect id={id("forma")} value={line.forma} onValueChange={(forma) => set({ forma })} options={paid ? FORM_OPTIONS : [{ value: NONE, label: "Não definida" }, ...FORM_OPTIONS]} placeholder="Selecionar" />
        </Field>
        {paid && <Field label="Data do pagamento" htmlFor={id("pago")} required error={errors.pagoEm}><DateField id={id("pago")} value={line.pagoEm} onChange={(pagoEm) => set({ pagoEm })} /></Field>}
        {line.forma === "boleto" && line.frequencia === ONCE && (
          <Field label="Linha digitável (opcional)" htmlFor={id("linha")} className={paid ? "sm:col-span-3" : "sm:col-span-4"}><Input id={id("linha")} value={line.linha} maxLength={80} inputMode="numeric" onChange={(e) => set({ linha: e.target.value })} className={FIELD} placeholder="Números do boleto, para copiar na hora de pagar" /></Field>
        )}
        {line.frequencia !== ONCE && <p className="text-sm text-muted-foreground sm:col-span-4">As próximas contas aparecem sozinhas em cada mês, sempre pendentes e com valor previsto, que pode ser ajustado conta a conta. Em mês sem esse dia, vence no último dia do mês.</p>}
      </>}
    </div>
  )
}

/**
 * Nova despesa (uma ou várias de uma vez) e edição de uma conta existente.
 * Várias linhas vão em UMA chamada transacional: ou grava todas, ou nenhuma. O pop-up só fecha depois da
 * confirmação do banco; em erro, tudo o que foi digitado fica na tela e a linha com problema é destacada.
 */
export function ExpenseDialog({ shopId, today, range, suggestedDate, entry, categories, onClose, onSaved }: {
  shopId: string; today: string; /** Mês aberto na tela: conta salva fora dele é avisada, não misturada. */ range: { de: string; ate: string }
  /** Vencimento sugerido (dia ou mês selecionado); qualquer data pode ser escolhida. */ suggestedDate: string
  entry?: ExpenseEntry; categories: string[]; onClose: () => void; onSaved: () => Promise<unknown>
}) {
  const mode: Mode = !entry ? "nova" : entry.situacao === "pendente" ? "pendente" : "detalhes"
  // o id de cada linha nasce aqui e vale em todas as tentativas: repetir depois de uma falha não duplica
  const blank = (): Line => ({ id: newKey(), descricao: "", categoria: "", valor: null, vencimento: suggestedDate, frequencia: ONCE, situacao: "pendente", pagoEm: today, forma: NONE, linha: "" })
  const [lines, setLines] = useState<Line[]>(() => [entry ? { ...blank(), descricao: entry.descricao, categoria: entry.categoria, valor: entry.valor_centavos, vencimento: entry.data, forma: entry.forma ?? NONE, linha: entry.linha_digitavel ?? "" } : blank()])
  const [errors, setErrors] = useState<Record<string, LineErrors>>({})
  const [badLine, setBadLine] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const many = lines.length > 1
  const total = lines.reduce((t, l) => t + (l.valor ?? 0), 0)

  const done = async (message: string) => { await onSaved(); toast.success(message); onClose() }
  const failed = (e: unknown) => {
    const line = /^invalid_expense_line:(\d+)$/.exec((e as { message?: string })?.message ?? "")
    if (line) {
      setBadLine(lines[Number(line[1]) - 1]?.id ?? null)
      setFailure(`A despesa ${line[1]} foi recusada: confira a descrição, a categoria, o valor, o vencimento e o pagamento. Nenhuma despesa foi gravada.`)
    } else setFailure(financeErrorMessage(e) + (many ? " Nenhuma despesa foi gravada." : ""))
    if (notPendingOrPaid(e)) void onSaved()
  }
  const save = useMutation({
    mutationFn: () => {
      if (entry) return mode === "detalhes" ? updateExpenseDetails(entry.id, lines[0].descricao.trim(), lines[0].categoria.trim()) : updateExpense(entry.id, toInput(lines[0]))
      return many ? createExpenses(shopId, lines.map(toCreate)) : createExpense({ ...toCreate(lines[0]), shopId })
    },
    onSuccess: () => {
      const fora = mode === "detalhes" ? [] : lines.filter((l) => l.vencimento < range.de || l.vencimento > range.ate)
      const outro = fora.length === 0 ? "" : many ? ` ${fora.length === lines.length ? "Todas vencem" : `${fora.length} ${fora.length === 1 ? "vence" : "vencem"}`} em outro mês: abra o mês do vencimento para ver.` : ` O vencimento é em ${formatMonth(fora[0].vencimento)}: abra esse mês para ver a conta.`
      const l = lines[0]
      return done((entry ? "Despesa atualizada." : many ? `${lines.length} despesas cadastradas.` : l.frequencia !== ONCE ? "Despesa recorrente criada." : isPaid(l) ? "Despesa paga registrada." : "Despesa cadastrada.") + outro)
    },
    onError: failed,
  })
  const remove = useMutation({ mutationFn: () => deleteExpense(entry!.id), onSuccess: () => done("Despesa excluída."), onError: failed })
  const busy = save.isPending || remove.isPending

  // depois de uma tentativa de salvar, cada correção revalida a linha na hora: o aviso some assim que o campo fica certo
  const patch = (id: string, p: Partial<Line>) => {
    const line = lines.find((l) => l.id === id)
    if (!line) return
    const next = { ...line, ...p }
    setLines((ls) => ls.map((l) => (l.id === id ? next : l)))
    if (errors[id]) setErrors((all) => ({ ...all, [id]: validate(next, today, mode) }))
    if (badLine === id) setBadLine(null)
    setFailure(null) // o aviso geral vale para a tentativa anterior; some quando a pessoa volta a corrigir
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const next = Object.fromEntries(lines.map((l) => [l.id, validate(l, today, mode)]))
    const invalid = lines.filter((l) => Object.keys(next[l.id]).length > 0)
    setErrors(next)
    setBadLine(null)
    setFailure(invalid.length && many ? `Corrija ${invalid.length === 1 ? "a despesa destacada" : `as ${invalid.length} despesas destacadas`} para salvar todas.` : null)
    if (invalid.length === 0) save.mutate()
  }

  const title = mode === "nova" ? "Nova despesa" : "Editar despesa"
  const description = mode === "nova" ? "Cadastre uma conta ou várias de uma vez para acompanhar vencimentos e pagamentos."
    : mode === "detalhes" ? (entry!.situacao === "paga" ? "Conta paga: só a descrição e a categoria mudam aqui. Para corrigir valor, data ou forma do pagamento, reverta o pagamento e registre de novo." : "Lançamento antigo: só a descrição e a categoria podem ser corrigidas.")
      : entry!.recurrence_id ? "A alteração vale só para esta conta; as dos outros meses não mudam." : "Altere os dados desta conta em aberto."
  return (
    <Frame title={title} description={description} onClose={onClose} wide={mode === "nova"}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {lines.map((l, i) => {
          const bad = badLine === l.id || Object.keys(errors[l.id] ?? {}).length > 0
          const fields = <LineFields n={i + 1} line={l} errors={errors[l.id] ?? {}} mode={mode} categories={categories} set={(p) => patch(l.id, p)} />
          return !many ? <div key={l.id}>{fields}</div> : (
            <fieldset key={l.id} aria-invalid={bad || undefined} className={cn("flex flex-col gap-3 rounded-card border p-3 sm:p-4", bad ? "border-danger/60 bg-danger/[0.04]" : "border-border")}>
              <legend className="sr-only">Despesa {i + 1}</legend>
              <div className="flex items-center justify-between gap-3">
                <p aria-hidden="true" className="text-sm font-semibold text-muted-foreground">Despesa {i + 1}</p>
                <Button type="button" variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9" aria-label={`Remover despesa ${i + 1}`} disabled={busy} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
              </div>
              {fields}
            </fieldset>
          )
        })}

        {mode === "nova" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="outline" className="h-11 gap-2 md:h-10" disabled={busy || lines.length >= MAX_LINES} onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="h-4 w-4" aria-hidden="true" />Adicionar outra despesa</Button>
            {many && <p className="text-sm text-muted-foreground" aria-live="polite">{lines.length} despesas · <span className="font-display font-semibold tabular-nums text-foreground">{formatPrice(total)}</span></p>}
          </div>
        )}

        <Failure message={failure} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {mode === "pendente" ? (
            confirmDelete
              ? <Button type="button" variant="outline" className="h-11 border-danger/40 text-danger md:h-10" disabled={busy} onClick={() => remove.mutate()}>{remove.isPending ? "Excluindo…" : "Confirmar exclusão"}</Button>
              : <Button type="button" variant="ghost" className="h-11 text-danger md:h-10" disabled={busy} onClick={() => setConfirmDelete(true)}>Excluir despesa</Button>
          ) : <span />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" className="h-11 md:h-10" onClick={onClose}>Cancelar</Button>
            <Button type="submit" className="h-11 md:h-10" disabled={busy}>{save.isPending ? "Salvando…" : entry ? "Salvar alterações" : many ? `Salvar todas (${lines.length})` : "Salvar despesa"}</Button>
          </div>
        </div>
      </form>
    </Frame>
  )
}

/** Marcar como paga: data, valor efetivamente pago e forma. A conta só muda de situação depois da confirmação do banco. */
export function PayExpenseDialog({ entry, today, onClose, onSaved }: { entry: ExpenseEntry; today: string; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [pagoEm, setPagoEm] = useState(today)
  const [valor, setValor] = useState<number | null>(entry.valor_centavos)
  const [forma, setForma] = useState<ExpenseForm>(entry.forma ?? "pix")
  const [error, setError] = useState<string | null>(null)
  const pay = useMutation({
    mutationFn: () => payExpense(entry.id, { pagoEm, valor: valor!, forma }),
    onSuccess: async () => { await onSaved(); toast.success("Pagamento registrado."); onClose() },
    onError: (e) => { setError(financeErrorMessage(e)); if (notPendingOrPaid(e)) void onSaved() },
  })
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!valor) { setError("Informe o valor pago, maior que zero."); return }
    if (pagoEm > today) { setError("A data do pagamento não pode ser futura."); return }
    setError(null)
    pay.mutate()
  }
  return (
    <Frame title="Marcar como paga" description={`${entry.descricao} · ${formatPrice(entry.valor_centavos)} · vence em ${formatDateBR(entry.data)}`} onClose={onClose}>
      <form noValidate onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Data do pagamento" htmlFor="pg-data" required><DateField id="pg-data" value={pagoEm} onChange={setPagoEm} /></Field>
        <Field label="Valor pago (R$)" htmlFor="pg-valor" required><MoneyInput id="pg-valor" defaultCents={valor} onCentsChange={setValor} /></Field>
        <Field label="Forma de pagamento" htmlFor="pg-forma" required className="sm:col-span-2"><OptionSelect id="pg-forma" value={forma} onValueChange={(v) => setForma(v as ExpenseForm)} options={FORM_OPTIONS} /></Field>
        <div className="flex flex-col gap-3 sm:col-span-2">
          <Failure message={error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="h-11 md:h-10" onClick={onClose}>Cancelar</Button>
            <Button type="submit" className="h-11 md:h-10" disabled={pay.isPending}>{pay.isPending ? "Registrando…" : "Confirmar pagamento"}</Button>
          </div>
        </div>
      </form>
    </Frame>
  )
}

/**
 * Detalhes de uma conta (abre ao clicar na lista): dados, histórico de pagamentos e reversões e as ações da situação.
 * Reverter pede confirmação e só muda a tela depois que o banco confirma; nada do histórico é apagado.
 */
export function ExpenseDetailDialog({ entry, today, tz, onClose, onPay, onEdit, onSaved }: {
  entry: ExpenseEntry; today: string; tz: string; onClose: () => void; onPay: () => void; onEdit: () => void; onSaved: () => Promise<unknown>
}) {
  const view = expenseView(entry, today)
  const [variant, label] = EXPENSE_BADGE[view]
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const events = useQuery({ queryKey: ["expenses", "eventos", entry.id], queryFn: () => fetchExpenseEvents(entry.id) })
  const revert = useMutation({
    mutationFn: () => revertExpensePayment(entry.id),
    onSuccess: async () => { await onSaved(); toast.success(entry.data < today ? "Pagamento revertido. A conta voltou a ficar vencida." : "Pagamento revertido. A conta voltou a ficar pendente."); onClose() },
    onError: (e) => { setError(financeErrorMessage(e)); setConfirming(false); if (notPendingOrPaid(e)) void onSaved() },
  })
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text.replace(/\D/g, "")); toast.success("Linha digitável copiada.") } catch { toast.error("Não foi possível copiar. Selecione os números manualmente.") }
  }
  const rows: [string, ReactNode][] = [
    ["Valor", <span className="font-display font-semibold tabular-nums">{formatPrice(entry.valor_centavos)}{view === "pendente" && entry.recurrence_id ? " (previsto)" : ""}</span>],
    [view === "legado" ? "Data do lançamento" : "Vencimento", formatDateBR(entry.data)],
    ["Categoria", entry.categoria],
    ...(entry.forma ? [[view === "paga" ? "Forma de pagamento" : "Forma prevista", expenseFormLabel(entry.forma)] as [string, ReactNode]] : []),
    ...(view === "paga" ? [["Pago em", formatDateBR(entry.pago_em!)], ["Valor pago", <span className="font-display font-semibold tabular-nums">{formatPrice(entry.valor_pago_centavos!)}</span>]] as [string, ReactNode][] : []),
  ]
  return (
    <Frame title={entry.descricao} description={entry.recurrence_id ? "Conta de uma despesa recorrente. O que for feito aqui vale só para este vencimento." : view === "legado" ? "Lançado antes do controle de contas a pagar: não há pagamento registrado para reverter." : "Detalhes da conta."} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge variant={variant}>{label}</StatusBadge>
          {entry.recurrence_id && <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><Repeat className="h-4 w-4" aria-hidden="true" />Recorrente</span>}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {rows.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-sm text-muted-foreground">{k}</dt><dd className="truncate text-base">{v}</dd></div>)}
        </dl>
        {entry.linha_digitavel && (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-alt p-3">
            <p className="text-sm text-muted-foreground">Linha digitável</p>
            <p className="break-all font-mono text-sm">{entry.linha_digitavel}</p>
            <Button variant="outline" className="h-11 gap-2 self-start md:h-9" onClick={() => void copy(entry.linha_digitavel!)}><Copy className="h-4 w-4" aria-hidden="true" />Copiar</Button>
          </div>
        )}
        {events.data && events.data.length > 0 && (
          <section aria-label="Histórico de pagamentos" className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Histórico</h3>
            <ul className="divide-y divide-border text-sm">
              {events.data.map((ev) => (
                <li key={ev.id} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="min-w-0">{ev.tipo === "pagamento" ? "Pagamento" : "Pagamento revertido"} · <span className="tabular-nums">{formatPrice(ev.valor_centavos)}</span>{ev.forma ? ` · ${expenseFormLabel(ev.forma)}` : ""}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{formatDateTime(ev.criado_em, tz)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Failure message={error} />
        {confirming ? (
          <div role="alertdialog" aria-label="Confirmar reversão" className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning/[0.06] p-3">
            <p className="text-sm">Reverter o pagamento de <strong>{formatPrice(entry.valor_pago_centavos ?? entry.valor_centavos)}</strong>? A conta volta para {entry.data < today ? "Vencida" : "Pendente"} e o valor deixa de contar como pago. O histórico é mantido.</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" className="h-11 md:h-10" disabled={revert.isPending} onClick={() => setConfirming(false)}>Manter como paga</Button>
              <Button className="h-11 md:h-10" disabled={revert.isPending} onClick={() => revert.mutate()}>{revert.isPending ? "Revertendo…" : "Confirmar reversão"}</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" className="h-11 gap-2 md:h-10" onClick={onEdit}><Pencil className="h-4 w-4" aria-hidden="true" />Editar</Button>
            {entry.situacao === "paga" && <Button variant="outline" className="h-11 gap-2 md:h-10" onClick={() => { setError(null); setConfirming(true) }}><Undo2 className="h-4 w-4" aria-hidden="true" />Reverter pagamento</Button>}
            {entry.situacao === "pendente" && <Button className="h-11 gap-2 md:h-10" onClick={onPay}><Check className="h-4 w-4" aria-hidden="true" />Marcar como paga</Button>}
          </div>
        )}
      </div>
    </Frame>
  )
}
