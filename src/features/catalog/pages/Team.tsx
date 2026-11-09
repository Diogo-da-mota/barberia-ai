import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil, Plus, Trash2, UserPlus } from "lucide-react"
import { Button } from "@/ui/button"
import { EmptyState, Panel, StatusBadge } from "@/ui/finance"
import { Skeleton } from "@/ui/skeleton"
import { toast } from "@/ui/sonner"
import { formatPhone } from "@/lib/br"
import { deleteProfessional, fetchBarbers, fetchProfessionalContacts, fetchProfessionals, fetchServices, fetchTeamLinks } from "../api"
import { CatalogFrame, ShopGate } from "../components/CatalogFrame"
import type { MyBarbershop } from "@/features/home/domain"
import { ConfirmDelete } from "../components/ConfirmDelete"
import { InviteDialog } from "../components/InviteDialog"
import { ProfessionalCard } from "../components/ProfessionalCard"
import { ProfessionalDialog } from "../components/ProfessionalDialog"
import type { Professional } from "../domain"
import { useActiveBarbershop } from "../hooks/useActiveBarbershop"

export function Team() {
  const gate = useActiveBarbershop()
  return (
    <CatalogFrame title="Equipe" description="Profissionais, serviços que cada um atende e a jornada semanal (abra um profissional para editar os horários).">
      <ShopGate gate={gate}>{(shop, canManage) => <TeamList shop={shop} canManage={canManage} />}</ShopGate>
    </CatalogFrame>
  )
}

function TeamList({ shop, canManage }: { shop: MyBarbershop; canManage: boolean }) {
  const shopId = shop.id
  const queryClient = useQueryClient()
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<Professional | "novo" | null>(null)
  const [deleting, setDeleting] = useState<Professional | null>(null)

  const team = useQuery({ queryKey: ["professionals", shopId], queryFn: () => fetchProfessionals(shopId) })
  const services = useQuery({ queryKey: ["services", shopId], queryFn: () => fetchServices(shopId) })
  const barbers = useQuery({ queryKey: ["barbers", shopId], queryFn: () => fetchBarbers(shopId), enabled: canManage })
  const links = useQuery({ queryKey: ["team-links", shopId], queryFn: () => fetchTeamLinks(shopId), enabled: canManage })
  const contacts = useQuery({ queryKey: ["professional-contacts", shopId], queryFn: () => fetchProfessionalContacts(shopId), enabled: canManage })
  const serviceList = services.data?.status === "ok" ? services.data.data : []
  const serviceNames = new Map(serviceList.map((service) => [service.id, service.nome]))

  const remove = useMutation({
    mutationFn: (professional: Professional) => deleteProfessional(shopId, professional.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["professionals", shopId] })
      toast.success("Profissional excluído.")
      setDeleting(null)
    },
    onError: () => toast.error("Não foi possível excluir o profissional. Tente novamente."),
  })

  if (team.isError) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm font-semibold">Não foi possível carregar a equipe</p>
        <Button variant="outline" className="h-11 md:h-10" disabled={team.isFetching} onClick={() => void team.refetch()}>
          Tentar novamente
        </Button>
      </div>
    )
  }
  if (!team.data) {
    return (
      <div role="status" aria-label="Carregando equipe" className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }
  if (team.data.status === "unavailable") {
    return <EmptyState title="Equipe indisponível" description="O banco de dados ainda está sendo preparado." />
  }

  const list = team.data.data
  const newButton = (
    <Button className="h-11 shrink-0 gap-1 md:h-10" onClick={() => setEditing("novo")}>
      <Plus className="h-4 w-4" aria-hidden="true" />
      Novo profissional
    </Button>
  )

  // o convite fica ao lado esquerdo de "Novo profissional" e abre um pop-up
  const inviteButton = (
    <Button variant="outline" className="h-11 shrink-0 gap-1 md:h-10" onClick={() => setInviting(true)}>
      <UserPlus className="h-4 w-4" aria-hidden="true" />
      Gerar link do convite
    </Button>
  )

  return (
    <>
      {canManage && list.length > 0 && <div className="flex flex-wrap justify-end gap-2">{inviteButton}{newButton}</div>}
      {canManage && <InviteDialog shop={shop} open={inviting} onOpenChange={setInviting} />}

      {list.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nenhum profissional cadastrado"
            description={canManage ? "Cadastre quem atende e os serviços de cada um." : "O gerente ainda não cadastrou a equipe."}
            action={canManage ? <div className="flex flex-wrap justify-center gap-2">{inviteButton}{newButton}</div> : undefined}
          />
        </Panel>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" aria-label="Profissionais">
          {list.map((professional) => {
            const names = professional.service_ids.flatMap((id) => serviceNames.get(id) ?? [])
            const contato = contacts.data?.[professional.id]
            return (
              <li key={professional.id} className="flex">
                <ProfessionalCard
                  nome={professional.nome}
                  photoPath={professional.avatar_path}
                  inactive={!professional.ativo}
                  details={
                    <>
                      {names.length > 0 ? (
                        <ul className="flex flex-wrap gap-1.5" aria-label={`Serviços de ${professional.nome}`}>
                          {names.map((name) => (
                            <li key={name}><StatusBadge variant="default">{name}</StatusBadge></li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[13px]">Nenhum serviço marcado</p>
                      )}
                      {contato?.telefone && <p className="mt-1.5 tabular-nums">{formatPhone(contato.telefone)}</p>}
                      {contato?.email && <p className="truncate">{contato.email}</p>}
                    </>
                  }
                  side={
                    canManage ? (
                      <>
                        <Button variant="ghost" size="icon" className="h-11 w-11 md:h-10 md:w-10" aria-label={`Editar ${professional.nome}`} onClick={() => setEditing(professional)}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-11 w-11 md:h-10 md:w-10" aria-label={`Excluir ${professional.nome}`} onClick={() => setDeleting(professional)}>
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </>
                    ) : null
                  }
                />
              </li>
            )
          })}
        </ul>
      )}

      <ProfessionalDialog
        shopId={shopId}
        professional={editing === "novo" ? null : editing}
        services={serviceList}
        barbers={barbers.data ?? []}
        linkedProfileId={editing && editing !== "novo" ? (links.data?.[editing.id] ?? null) : null}
        contact={editing && editing !== "novo" ? (contacts.data?.[editing.id] ?? null) : null}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      <ConfirmDelete
        open={deleting !== null}
        title="Excluir profissional?"
        description={`${deleting?.nome ?? "O profissional"} sai da equipe e deixa de aparecer para os clientes.`}
        confirmLabel="Excluir profissional"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}
