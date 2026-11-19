import { useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { isMissingSchema } from "@/features/booking/domain"
import { Button } from "@/ui/button"
import { Panel, StatusBadge } from "@/ui/finance"
import { toast } from "@/ui/sonner"
import { calendarEnabled, fetchConnection, fetchMyProfessional, finishLink, readCalendarReturn, startLink, unlink } from "./api"

const concluidos = new Set<string>()

/** Cartão de quem é profissional da barbearia: vincula o próprio Google Calendar, com consentimento próprio. */
export function CalendarCard({ shopId }: { shopId: string }) {
  const queryClient = useQueryClient()
  const mine = useQuery({ queryKey: ["my-professional", shopId], queryFn: () => fetchMyProfessional(shopId), retry: false })
  const professionalId = mine.data ?? null
  const connection = useQuery({ queryKey: ["calendar-connection", professionalId], queryFn: () => fetchConnection(professionalId!), enabled: Boolean(professionalId) })

  const link = useMutation({
    mutationFn: () => startLink(professionalId!),
    onSuccess: (url) => { window.location.assign(url) },
    onError: () => toast.error("Não foi possível iniciar o vínculo. Tente novamente."),
  })
  // Retorno do Google: conclui o vínculo aqui, com a sessão e o verificador deste navegador; o código sai do endereço na hora.
  useEffect(() => {
    const retorno = readCalendarReturn(window.location.hash)
    if (!retorno || concluidos.has(retorno.code)) return
    concluidos.add(retorno.code)
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`)
    finishLink(retorno.code, retorno.state)
      .then(async () => { await queryClient.invalidateQueries({ queryKey: ["calendar-connection"] }); toast.success("Google Calendar vinculado.") })
      .catch(() => toast.error("Não foi possível concluir o vínculo. Comece de novo por este navegador."))
  }, [queryClient])
  const remove = useMutation({
    mutationFn: () => unlink(professionalId!),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["calendar-connection", professionalId] }); toast.success("Calendário desvinculado. Eventos já criados no Google permanecem.") },
    onError: () => toast.error("Não foi possível desvincular. Tente novamente."),
  })

  if (mine.isError && isMissingSchema(mine.error)) return null
  if (!professionalId) return null // só quem está ligado a um profissional vê este cartão
  const active = connection.data?.status === "ativo"
  const enabled = calendarEnabled()

  return (
    <Panel className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold">Google Calendar</h2>
        <StatusBadge variant={active ? "income" : "default"}>{active ? "Vinculado" : "Não vinculado"}</StatusBadge>
      </div>
      <p className="text-sm text-muted-foreground">
        Suas reservas aparecem no seu Google Calendar. A sincronização é de mão única: eventos criados no Google não bloqueiam horários aqui.
        Pedimos só permissão para criar e editar eventos.
      </p>
      {!enabled && !active && <p className="text-sm text-muted-foreground">Esta integração ainda não foi ativada pelo administrador do sistema.</p>}
      <div className="flex flex-wrap gap-2">
        {!active && <Button className="h-11 md:h-10" disabled={!enabled || link.isPending} onClick={() => link.mutate()}>Vincular meu Google Calendar</Button>}
        {active && <Button variant="outline" className="h-11 md:h-10" disabled={remove.isPending} onClick={() => remove.mutate()}>Desvincular</Button>}
      </div>
    </Panel>
  )
}
