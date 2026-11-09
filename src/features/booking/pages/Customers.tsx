import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CatalogFrame, ShopGate } from "@/features/catalog/components/CatalogFrame"
import { useActiveBarbershop } from "@/features/catalog/hooks/useActiveBarbershop"
import { Link } from "react-router-dom"
import { Button } from "@/ui/button"
import { EmptyState, Panel } from "@/ui/finance"
import { Input } from "@/ui/input"
import { Skeleton } from "@/ui/skeleton"
import { cn } from "@/lib/utils"
import { fetchCustomerBookings, fetchCustomerConsents } from "../api"
import { CustomerCard } from "../components/CustomerCard"
import { aggregateCustomers, isMissingSchema } from "../domain"
import { shopPath } from "@/lib/shopPaths"

export function Customers() {
  const gate = useActiveBarbershop()
  return (
    <CatalogFrame title="Clientes" description="Quem já agendou: histórico, termos aceitos e próximo agendamento." wide>
      <ShopGate gate={gate}>{(shop, canManage) => <CustomerList shopId={shop.id} slug={shop.slug} active={shop.status === "ativo"} tz={shop.fuso ?? "America/Sao_Paulo"} own={!canManage} />}</ShopGate>
    </CatalogFrame>
  )
}

function CustomerList({ shopId, slug, active, tz, own }: { shopId: string; slug: string; active: boolean; tz: string; own: boolean }) {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"todos" | "avisos" | "novidades">("todos")
  const bookings = useQuery({ queryKey: ["customer-bookings", shopId], queryFn: () => fetchCustomerBookings(shopId) })

  // consentimento vigente de novidades/promoções: só a gestão lê o de todos os clientes (o RLS esconde o resto)
  const consents = useQuery({ queryKey: ["customer-consents", shopId], queryFn: () => fetchCustomerConsents(shopId), enabled: !own })
  const marketing = new Map((consents.data ?? []).map((x) => [x.profile_id, x.marketing]))

  if (isMissingSchema(bookings.error)) return <EmptyState title="Clientes indisponíveis" description="O agendamento ainda está sendo preparado no banco de dados." />
  if (bookings.isError) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm font-semibold">Não foi possível carregar os clientes</p>
        <Button variant="outline" className="h-11 md:h-10" onClick={() => void bookings.refetch()}>Tentar novamente</Button>
      </div>
    )
  }
  if (!bookings.data) return <div role="status" aria-label="Carregando clientes" className="flex flex-col gap-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>

  const all = aggregateCustomers(bookings.data)
  const term = search.trim().toLowerCase()
  const digits = term.replace(/\D/g, "")
  const novidadesOf = (c: (typeof all)[number]) => (marketing.has(c.id) ? marketing.get(c.id)! : c.novidades)
  const list = all
    .filter((c) => !term || c.nome.toLowerCase().includes(term) || (digits.length > 0 && c.whatsapp.includes(digits)))
    .filter((c) => filter === "todos" || (filter === "avisos" ? c.avisos === true : novidadesOf(c) === true))
  const aceitamAvisos = all.filter((c) => c.avisos === true).length
  const aceitamNovidades = all.filter((c) => novidadesOf(c) === true).length

  if (all.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="Nenhum cliente ainda"
          description={own ? "Os clientes dos seus atendimentos aparecem aqui." : "Os clientes aparecem aqui depois da primeira reserva pela página pública."}
          action={!own && active ? <Button asChild className="h-11 md:h-10"><Link to={shopPath(slug)}>Abrir página pública</Link></Button> : undefined}
        />
      </Panel>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm font-medium">
          Buscar por nome ou WhatsApp
          <Input value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 text-base md:h-10 md:text-sm" autoComplete="off" />
        </label>
        {!own && (
          <div role="group" aria-label="Filtrar por termos aceitos" className="flex flex-wrap gap-2">
            {([["todos", `Todos (${all.length})`], ["avisos", `Aceitam avisos (${aceitamAvisos})`], ["novidades", `Aceitam novidades (${aceitamNovidades})`]] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}
                className={cn("min-h-11 rounded-xl border px-3.5 text-sm font-medium transition-colors md:min-h-10", filter === id ? "border-primary/70 bg-primary/10" : "border-border bg-card hover:bg-foreground/5")}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum cliente encontrado para essa busca.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((c) => <CustomerCard key={c.id} customer={c} tz={tz} novidades={novidadesOf(c)} showConsents={!own} />)}
        </ul>
      )}
    </>
  )
}
