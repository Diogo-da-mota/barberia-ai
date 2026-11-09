import { useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ProfessionalTag } from "@/features/catalog/components/ProfessionalPhoto"
import { fetchProfessionals, fetchServices } from "@/features/catalog/api"
import { formatPrice } from "@/features/catalog/domain"
import type { MyBarbershop } from "@/features/home/domain"
import { formatDateTime } from "@/features/booking/domain"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { EmptyState, Field, MoneyInput, StatusBadge } from "@/ui/finance"
import { Input } from "@/ui/input"
import { OptionSelect } from "@/ui/option-select"
import { toast } from "@/ui/sonner"
import { deleteRule, fetchCommissions, fetchRules, saveRule, type CommissionRow } from "../api"
import { describeRule, financeErrorMessage, formatCommissionStatus, parsePercent, type RuleKind } from "../domain"
import { commissionsByProfessional } from "../summary"
import { FIELD, Loading, QueryError, Section, StatStrip } from "./FinanceUI"

const LIMIT = 200

/** Lista de comissões, também usada na visão do barbeiro (Meus ganhos). */
export function CommissionList({ items, tz }: { items: CommissionRow[]; tz: string }) {
  if (items.length === 0) return <EmptyState title="Nenhuma comissão ainda" description="Elas aparecem quando um atendimento é concluído e existe uma regra de comissão." />
  return (
    <ul className="divide-y divide-border">
      {items.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold"><ProfessionalTag nome={c.professionals?.nome ?? "Profissional"} path={c.professionals?.avatar_path} /> · {formatPrice(c.valor_centavos)}</p>
            <p className="text-sm text-muted-foreground">{formatDateTime(c.criado_em, tz)} · {describeRule(c.regra_tipo, c.regra_valor)} sobre {formatPrice(c.base_centavos)}</p>
          </div>
          <StatusBadge variant={c.status === "liquidada" ? "income" : c.status === "cancelada" ? "default" : "warning"}>{formatCommissionStatus(c.status)}</StatusBadge>
        </li>
      ))}
    </ul>
  )
}

type StatusFilter = "todas" | "provisionada" | "liquidada"

export function CommissionsTab({ shop }: { shop: MyBarbershop }) {
  const queryClient = useQueryClient()
  const tz = shop.fuso ?? "America/Sao_Paulo"
  const rules = useQuery({ queryKey: ["rules", shop.id], queryFn: () => fetchRules(shop.id) })
  const commissions = useQuery({ queryKey: ["commissions", shop.id], queryFn: () => fetchCommissions(shop.id) })
  const team = useQuery({ queryKey: ["professionals", shop.id], queryFn: () => fetchProfessionals(shop.id) })
  const services = useQuery({ queryKey: ["services", shop.id], queryFn: () => fetchServices(shop.id) })

  const [prof, setProf] = useState("")
  const [service, setService] = useState("")
  const [tipo, setTipo] = useState<RuleKind>("percentual")
  const [valor, setValor] = useState("")
  const [valorFixo, setValorFixo] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>("todas")

  const professionals = team.data?.status === "ok" ? team.data.data : []
  const serviceList = services.data?.status === "ok" ? services.data.data : []
  const nameOf = (id: string | null, list: { id: string; nome: string }[], fallback: string) => (id ? list.find((x) => x.id === id)?.nome ?? "—" : fallback)

  const refreshAll = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["rules", shop.id] }),
    queryClient.invalidateQueries({ queryKey: ["commissions", shop.id] }),
    queryClient.invalidateQueries({ queryKey: ["finance-report", shop.id] }),
  ])
  const save = useMutation({
    mutationFn: (v: number) => saveRule({ shopId: shop.id, professionalId: prof || null, serviceId: service || null, tipo, valor: v }),
    onSuccess: async () => { setValor(""); setValorFixo(null); setError(null); await refreshAll(); toast.success("Regra salva.") },
    onError: (e) => setError(financeErrorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: deleteRule,
    onSuccess: async () => { await refreshAll(); toast.success("Regra removida. Comissões já congeladas não mudam.") },
    onError: (e) => toast.error(financeErrorMessage(e)),
  })
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const v = tipo === "percentual" ? parsePercent(valor) : valorFixo
    if (v === null) { setError(tipo === "percentual" ? "Informe um percentual de 0 a 100, como 40 ou 12,5." : "Informe um valor em reais, como 25,00."); return }
    setError(null)
    save.mutate(v)
  }

  const byProfessional = useMemo(() => commissionsByProfessional(commissions.data ?? []), [commissions.data])

  if (rules.isError || commissions.isError) return <QueryError error={rules.error ?? commissions.error} onRetry={() => { void rules.refetch(); void commissions.refetch() }} />
  if (!rules.data || !commissions.data) return <Loading label="Carregando comissões" />

  const pendente = byProfessional.reduce((t, p) => t + p.pendente, 0)
  const repassado = byProfessional.reduce((t, p) => t + p.repassado, 0)
  const listed = filter === "todas" ? commissions.data : commissions.data.filter((c) => c.status === filter)

  return (
    <div className="flex flex-col gap-4">
      <StatStrip items={[
        { label: "Comissões calculadas", value: formatPrice(pendente + repassado) },
        { label: "Pendentes (a repassar)", value: formatPrice(pendente), tone: pendente > 0 ? "warning" : undefined },
        { label: "Já repassadas", value: formatPrice(repassado), tone: "income" },
      ]} />
      {commissions.data.length >= LIMIT && <p className="-mt-2 text-xs text-muted-foreground">Somando as {LIMIT} comissões mais recentes.</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            title="Comissões calculadas"
            action={
              <div role="group" aria-label="Filtrar por situação" className="flex gap-1 rounded-md bg-surface-alt p-1">
                {([["todas", "Todas"], ["provisionada", "A repassar"], ["liquidada", "Repassadas"]] as const).map(([v, label]) => (
                  <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)} className={cn("min-h-9 rounded px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", filter === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</button>
                ))}
              </div>
            }
          >
            {listed.length === 0 && commissions.data.length > 0 ? <EmptyState title="Nenhuma comissão nesta situação" /> : <CommissionList items={listed} tz={tz} />}
          </Section>

        </div>

        <Section id="regras" title="Regras de comissão" description="Vale a regra mais específica: profissional + serviço, depois profissional, depois serviço, depois o padrão da barbearia. A regra é congelada quando o atendimento é concluído. Sem regra, não há comissão." className="self-start">
          {rules.data.length === 0 ? <EmptyState title="Nenhuma regra" description="Cadastre ao menos o padrão da barbearia." /> : (
            <ul className="divide-y divide-border">
              {rules.data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0">
                  <p className="min-w-0 text-base"><strong>{describeRule(r.tipo, r.valor)}</strong> · {nameOf(r.professional_id, professionals, "Todos os profissionais")} · {nameOf(r.service_id, serviceList, "Todos os serviços")}</p>
                  <Button variant="outline" className="h-11 md:h-10" disabled={remove.isPending} onClick={() => remove.mutate(r.id)}>Remover</Button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={onSubmit} className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2" noValidate>
            <Field label="Profissional" htmlFor="regra-prof">
              <OptionSelect id="regra-prof" value={prof || "todos"} onValueChange={(v) => setProf(v === "todos" ? "" : v)} options={[{ value: "todos", label: "Todos" }, ...professionals.map((p) => ({ value: p.id, label: p.nome }))]} />
            </Field>
            <Field label="Serviço" htmlFor="regra-serv">
              <OptionSelect id="regra-serv" value={service || "todos"} onValueChange={(v) => setService(v === "todos" ? "" : v)} options={[{ value: "todos", label: "Todos" }, ...serviceList.map((x) => ({ value: x.id, label: x.nome }))]} />
            </Field>
            <Field label="Tipo" htmlFor="regra-tipo">
              <OptionSelect id="regra-tipo" value={tipo} onValueChange={(v) => setTipo(v as RuleKind)} options={[{ value: "percentual", label: "Percentual do serviço" }, { value: "fixo", label: "Valor fixo por atendimento" }]} />
            </Field>
            <Field label={tipo === "percentual" ? "Percentual (%)" : "Valor (R$)"} htmlFor="regra-valor">
              {tipo === "percentual"
                ? <Input id="regra-valor" value={valor} onChange={(e) => setValor(e.target.value)} className={FIELD} inputMode="decimal" />
                : <MoneyInput id="regra-valor" onCentsChange={setValorFixo} />}
            </Field>
            <div className="sm:col-span-2 flex flex-col gap-2">
              {error && <p role="alert" className="text-sm text-expense">{error}</p>}
              <Button type="submit" className="h-11 md:h-10 sm:w-fit" disabled={save.isPending}>Salvar regra</Button>
            </div>
          </form>
        </Section>
      </div>
    </div>
  )
}
