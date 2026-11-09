import { useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { formatPrice } from "@/features/catalog/domain"
import type { MyBarbershop } from "@/features/home/domain"
import { localDate } from "@/features/booking/domain"
import { Button } from "@/ui/button"
import { DateField } from "@/ui/date-time"
import { EmptyState, Field, MoneyInput } from "@/ui/finance"
import { Input } from "@/ui/input"
import { toast } from "@/ui/sonner"
import { addExpense, fetchExpenses } from "../api"
import { financeErrorMessage } from "../domain"
import { sumByKey } from "../summary"
import { FIELD, Loading, QueryError, Section, ShareBars, StatStrip } from "./FinanceUI"

export function ExpensesTab({ shop, range }: { shop: MyBarbershop; range: { de: string; ate: string } }) {
  const queryClient = useQueryClient()
  const expenses = useQuery({ queryKey: ["expenses", shop.id, range.de, range.ate], queryFn: () => fetchExpenses(shop.id, range.de, range.ate) })
  const [descricao, setDescricao] = useState("")
  const [categoria, setCategoria] = useState("")
  const [valor, setValor] = useState<number | null>(null)
  const [data, setData] = useState(() => localDate(new Date().toISOString(), shop.fuso ?? "America/Sao_Paulo"))
  const [error, setError] = useState<string | null>(null)
  const add = useMutation({
    mutationFn: (cents: number) => addExpense({ shopId: shop.id, descricao, categoria, valor: cents, data }),
    onSuccess: async () => {
      setDescricao(""); setValor(null); setError(null)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["expenses", shop.id] }), queryClient.invalidateQueries({ queryKey: ["finance-report", shop.id] })])
      toast.success("Custo lançado.")
    },
    onError: (e) => setError(financeErrorMessage(e)),
  })
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const cents = valor
    if (!descricao.trim() || !categoria.trim()) { setError("Informe a descrição e a categoria."); return }
    if (!cents) { setError("Informe um valor maior que zero, como 1.200,00."); return }
    add.mutate(cents)
  }
  const categories = useMemo(() => sumByKey((expenses.data ?? []).map((x) => ({ key: x.categoria, cents: x.valor_centavos }))), [expenses.data])
  if (expenses.isError) return <QueryError error={expenses.error} onRetry={() => void expenses.refetch()} />
  if (!expenses.data) return <Loading label="Carregando custos" />
  const total = expenses.data.reduce((t, x) => t + x.valor_centavos, 0)

  return (
    <div className="flex flex-col gap-4">
      <StatStrip items={[
        { label: "Custos do mês", value: formatPrice(total), tone: total > 0 ? "expense" : undefined },
        { label: "Lançamentos", value: String(expenses.data.length) },
        { label: "Maior categoria", value: categories[0]?.key ?? "—" },
      ]} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title="Custos lançados" description="Do mais recente para o mais antigo, no mês selecionado." className="self-start">
          {expenses.data.length === 0 ? <EmptyState title="Nenhum custo neste mês" description="Aluguel, produtos, energia: lance aqui para ver o resultado estimado." /> : (
            <ul className="divide-y divide-border">
              {expenses.data.map((x) => (
                <li key={x.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-3 first:pt-0 last:pb-0">
                  <p className="min-w-0 truncate text-base font-medium">{x.descricao}</p>
                  <p className="row-span-2 font-display font-semibold tabular-nums text-expense">{formatPrice(x.valor_centavos)}</p>
                  <p className="text-sm text-muted-foreground"><span className="rounded-md border border-border bg-surface-alt px-2 py-0.5 text-xs">{x.categoria}</span> <span className="ml-1 tabular-nums">{x.data.split("-").reverse().join("/")}</span></p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="flex min-w-0 flex-col gap-4 self-start">
          <Section title="Lançar custo">
            <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" noValidate>
              <Field label="Descrição" htmlFor="custo-desc" className="sm:col-span-2"><Input id="custo-desc" value={descricao} maxLength={120} onChange={(e) => setDescricao(e.target.value)} className={FIELD} /></Field>
              <Field label="Categoria" htmlFor="custo-cat">
                <Input id="custo-cat" list="custo-categorias" value={categoria} maxLength={40} onChange={(e) => setCategoria(e.target.value)} className={FIELD} placeholder="aluguel, produtos…" />
                <datalist id="custo-categorias">{categories.map((c) => <option key={c.key} value={c.key} />)}</datalist>
              </Field>
              <Field label="Valor (R$)" htmlFor="custo-valor"><MoneyInput id="custo-valor" onCentsChange={setValor} /></Field>
              <Field label="Data" htmlFor="custo-data" className="sm:col-span-2"><DateField id="custo-data" value={data} onChange={setData} /></Field>
              <div className="sm:col-span-2 flex flex-col gap-2">
                {error && <p role="alert" className="text-sm text-expense">{error}</p>}
                <Button type="submit" className="h-11 md:h-10 sm:w-fit" disabled={add.isPending}>Lançar custo</Button>
              </div>
            </form>
          </Section>
          {categories.length > 0 && <Section title="Por categoria"><ShareBars items={categories} tone="expense" /></Section>}
        </div>
      </div>
    </div>
  )
}
