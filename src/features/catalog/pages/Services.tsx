import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/ui/button"
import { EmptyState, Panel } from "@/ui/finance"
import { Skeleton } from "@/ui/skeleton"
import { toast } from "@/ui/sonner"
import { Star, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { deleteService, fetchServiceSales, fetchServices } from "../api"
import { ServiceStats } from "../components/ServiceStats"
import { averageTicket, salesByService, topSellers, SALES_DAYS } from "../sales"
import { CatalogFrame, ShopGate } from "../components/CatalogFrame"
import { ConfirmDelete } from "../components/ConfirmDelete"
import { ServiceCard } from "../components/ServiceCard"
import { servicePhotos } from "../domain"
import { ServiceDialog } from "../components/ServiceDialog"
import { publicMediaUrl } from "@/features/site/api"
import type { Service } from "../domain"
import { useActiveBarbershop } from "../hooks/useActiveBarbershop"

export function Services() {
  const gate = useActiveBarbershop()
  return (
    <CatalogFrame title="Serviços" description="O que sua barbearia oferece, com preço e duração." banner="servicos" full>
      <ShopGate gate={gate}>{(shop, canManage) => <ServiceList shopId={shop.id} canManage={canManage} />}</ShopGate>
    </CatalogFrame>
  )
}

function ServiceList({ shopId, canManage }: { shopId: string; canManage: boolean }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Service | "novo" | null>(null)
  const [deleting, setDeleting] = useState<Service | null>(null)
  const [filter, setFilter] = useState<"todos" | "vendidos">("todos") // um filtro por vez; continua ao editar ou cadastrar

  const services = useQuery({ queryKey: ["services", shopId], queryFn: () => fetchServices(shopId) })

  // vendas reais (só gestão): base do "Mais vendidos", do selo e do ticket médio, no mesmo período
  const sales = useQuery({ queryKey: ["service-sales", shopId], queryFn: () => fetchServiceSales(shopId), enabled: canManage })

  const remove = useMutation({
    mutationFn: (service: Service) => deleteService(shopId, service.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["services", shopId] }),
        queryClient.invalidateQueries({ queryKey: ["professionals", shopId] }),
      ])
      toast.success("Serviço excluído.")
      setDeleting(null)
    },
    onError: () => toast.error("Não foi possível excluir o serviço. Tente novamente."),
  })

  if (services.isError) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm font-semibold">Não foi possível carregar os serviços</p>
        <Button variant="outline" className="h-11 md:h-10" disabled={services.isFetching} onClick={() => void services.refetch()}>
          Tentar novamente
        </Button>
      </div>
    )
  }
  if (!services.data) {
    return (
      <div role="status" aria-label="Carregando serviços" className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }
  if (services.data.status === "unavailable") {
    return <EmptyState title="Catálogo indisponível" description="O banco de dados ainda está sendo preparado." />
  }

  const list = services.data.data
  const counts = sales.data ? salesByService(sales.data.sales) : new Map<string, number>()
  const tops = topSellers(counts)
  const vendidos = list.filter((s) => (counts.get(s.id) ?? 0) > 0).sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
  const shown = filter === "vendidos" ? vendidos : list
  const ticket = canManage ? (sales.data ? averageTicket(sales.data.sales, sales.data.payments, sales.data.refunds) : null) : undefined
  const ativos = list.filter((s) => s.ativo).length
  const chips: { id: "todos" | "vendidos"; label: string; Icon: typeof Star | null }[] = [
    { id: "todos", label: `Todos (${list.length})`, Icon: null },
    ...(canManage ? [{ id: "vendidos" as const, label: `Mais vendidos (${vendidos.length})`, Icon: Star }] : []),
  ]
  const newButton = (
    <Button className="h-11 shrink-0 gap-1 md:h-10" onClick={() => setEditing("novo")}>
      <Plus className="h-4 w-4" aria-hidden="true" />
      Novo serviço
    </Button>
  )

  return (
    <>
      {list.length > 0 && <ServiceStats active={ativos} total={list.length} ticket={ticket} />}

      {list.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Filtrar serviços" className="flex flex-wrap gap-2">
            {chips.map(({ id, label, Icon }) => (
              <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}
                className={cn("inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors md:min-h-10", filter === id ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-card hover:bg-foreground/5")}>
                {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
                {label}
              </button>
            ))}
          </div>
          {canManage && newButton}
        </div>
      )}

      {list.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nenhum serviço cadastrado"
            description={canManage ? "Cadastre os serviços para montar a agenda e a página pública." : "O gerente ainda não cadastrou os serviços."}
            action={canManage ? newButton : undefined}
          />
        </Panel>
      ) : shown.length === 0 ? (
        <Panel><EmptyState title="Nenhuma venda no período" description={`Os mais vendidos aparecem aqui quando houver atendimentos concluídos nos últimos ${SALES_DAYS} dias.`} /></Panel>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Serviços">
          {shown.map((service) => (
            <li key={service.id} className="flex">
              <ServiceCard
                service={service}
                variant="painel"
                highlight={tops.has(service.id)}
                photos={servicePhotos(service, (path) => publicMediaUrl(path) ?? "")}
                badge={tops.has(service.id) ? (
                  <span title={`${counts.get(service.id)} atendimentos concluídos nos últimos ${SALES_DAYS} dias`} className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                    <TrendingUp className="h-3 w-3" aria-hidden="true" />Mais vendido
                  </span>
                ) : undefined}
                side={
                  canManage ? (
                    <>
                      <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg" aria-label={`Editar ${service.nome}`} onClick={() => setEditing(service)}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg border-danger/50 text-danger hover:bg-danger/10 hover:text-danger" aria-label={`Excluir ${service.nome}`} onClick={() => setDeleting(service)}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </>
                  ) : null
                }
              />
            </li>
          ))}
        </ul>
      )}

      <ServiceDialog
        shopId={shopId}
        service={editing === "novo" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      <ConfirmDelete
        open={deleting !== null}
        title="Excluir serviço?"
        description={`${deleting?.nome ?? "O serviço"} deixa de aparecer no catálogo e sai da lista de quem o atende. Reservas já feitas não mudam.`}
        confirmLabel="Excluir serviço"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}
