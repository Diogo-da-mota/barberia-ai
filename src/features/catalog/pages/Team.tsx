import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Mail, Pencil, Plus, Trash2, UserPlus } from "lucide-react"
import { Button } from "@/ui/button"
import { EmptyState, Panel, StatusBadge } from "@/ui/finance"
import { Skeleton } from "@/ui/skeleton"
import { toast } from "@/ui/sonner"
import { formatPhone } from "@/lib/br"
import { deleteProfessional, fetchBarbers, fetchProfessionalContacts, fetchProfessionals, fetchServices, fetchTeamOrigins, type AccountOrigin } from "../api"
import { GoogleIcon } from "@/features/auth/components/AuthForms"
import { CatalogFrame, ShopGate } from "../components/CatalogFrame"
import type { MyBarbershop } from "@/features/home/domain"
import { fetchPlanUsage } from "@/features/plans/api"
import { PlanLimitDialog } from "@/features/plans/PlanLimitDialog"
import { ConfirmDelete } from "../components/ConfirmDelete"
import { InviteDialog, InviteHistory } from "../components/InviteDialog"
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
  const [limitOpen, setLimitOpen] = useState(false)

  // staleTime 0: quem aceitou o convite (em outro aparelho) aparece ao abrir ou voltar para a página
  const team = useQuery({ queryKey: ["professionals", shopId], queryFn: () => fetchProfessionals(shopId), staleTime: 0 })
  const services = useQuery({ queryKey: ["services", shopId], queryFn: () => fetchServices(shopId) })
  // origem do cadastro (ícone ao lado do nome); "team-links" é a chave que o aceite do convite já atualiza
  const origins = useQuery({ queryKey: ["team-links", shopId], queryFn: () => fetchTeamOrigins(shopId), enabled: canManage, staleTime: 0, retry: false })
  const managers = useQuery({ queryKey: ["members", shopId, "gerente"], queryFn: () => fetchBarbers(shopId, "gerente"), enabled: canManage, staleTime: 0 })
  const usage = useQuery({ queryKey: ["plan-usage", shopId], queryFn: () => fetchPlanUsage(shopId), enabled: canManage, staleTime: 0 })
  const contacts = useQuery({ queryKey: ["professional-contacts", shopId], queryFn: () => fetchProfessionalContacts(shopId), enabled: canManage })
  const serviceList = services.data?.status === "ok" ? services.data.data : []
  const serviceNames = new Map(serviceList.map((service) => [service.id, service.nome]))

  const remove = useMutation({
    mutationFn: (professional: Professional) => deleteProfessional(shopId, professional.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["professionals", shopId] })
      await queryClient.invalidateQueries({ queryKey: ["plan-usage", shopId] })
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
  const max = usage.data?.max_profissionais ?? null
  // Vagas cheias (contadas no banco): cadastrar abre o pop-up do limite; o servidor recusa de qualquer forma.
  const atLimit = max !== null && (usage.data?.profissionais_ativos ?? 0) >= max
  const newButton = (
    <Button className="h-11 shrink-0 gap-1 md:h-10" onClick={() => (atLimit ? setLimitOpen(true) : setEditing("novo"))}>
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
      {/* indicador de vagas à esquerda de "Gerar link do convite", na mesma linha; no celular ele ocupa a linha de cima */}
      {canManage && (usage.data || list.length > 0) && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {usage.data && <TeamSlots ativos={usage.data.profissionais_ativos} max={usage.data.max_profissionais} />}
          {list.length > 0 && <div className="flex flex-wrap justify-end gap-2">{inviteButton}{newButton}</div>}
        </div>
      )}
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
                  portrait
                  nameIcon={origins.data?.[professional.id] && <OriginIcon origin={origins.data[professional.id]} />}
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

      {canManage && (managers.data?.length ?? 0) > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2" aria-label="Gerentes">
          {managers.data!.map((member) => (
            <li key={member.profile_id} className="flex">
              <ProfessionalCard nome={member.nome} details={<><StatusBadge variant="default">Gerente</StatusBadge>{member.email && <p className="mt-1.5 truncate">{member.email}</p>}</>} />
            </li>
          ))}
        </ul>
      )}

      {canManage && <InviteHistory shop={shop} />}

      <ProfessionalDialog
        shopId={shopId}
        professional={editing === "novo" ? null : editing}
        services={serviceList}
        contact={editing && editing !== "novo" ? (contacts.data?.[editing.id] ?? null) : null}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onPlanLimit={() => {
          setEditing(null)
          setLimitOpen(true)
          void queryClient.invalidateQueries({ queryKey: ["plan-usage", shopId] })
        }}
      />
      <PlanLimitDialog open={limitOpen} onOpenChange={setLimitOpen} shopName={shop.nome} max={max} />
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

const ORIGIN: Record<AccountOrigin, string> = { email: "Conta por e-mail", google: "Conta Google", manual: "Cadastro manual" }

/** Origem do cadastro: envelope (e-mail), Google ou usuário com + (manual). O texto aparece ao passar o mouse. */
function OriginIcon({ origin }: { origin: AccountOrigin }) {
  return (
    <span role="img" aria-label={ORIGIN[origin]} title={ORIGIN[origin]} className="inline-flex shrink-0 text-muted-foreground">
      {origin === "google" ? <GoogleIcon className="h-4 w-4" /> : origin === "email" ? <Mail className="h-4 w-4" aria-hidden="true" /> : <UserPlus className="h-4 w-4" aria-hidden="true" />}
    </span>
  )
}

/** Vagas do plano: profissionais ATIVOS contados no banco (get_plan_usage); inativos e gerentes não ocupam vaga. */
function TeamSlots({ ativos, max }: { ativos: number; max: number | null }) {
  if (max === null) return <p className="text-sm">{`Profissionais ativos: ${ativos} (sem limite)`}</p>
  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:min-w-48 sm:flex-1">
      <p className="text-sm">{`Profissionais ativos: ${ativos}/${max}`}</p>
      <div role="progressbar" aria-label="Profissionais ativos" aria-valuenow={ativos} aria-valuemin={0} aria-valuemax={max} className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${ativos >= max ? "bg-danger" : "bg-primary"}`} style={{ width: `${Math.min(100, (ativos / max) * 100)}%` }} />
      </div>
    </div>
  )
}
