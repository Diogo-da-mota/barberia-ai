import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { MessageSquare } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CatalogFrame, ShopGate } from "@/features/catalog/components/CatalogFrame"
import { useActiveBarbershop } from "@/features/catalog/hooks/useActiveBarbershop"
import { isMissingSchema } from "@/features/booking/domain"
import type { MyBarbershop } from "@/features/home/domain"
import { useMediaQuery } from "@/lib/useMediaQuery"
import { Button } from "@/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog"
import { EmptyState, Panel } from "@/ui/finance"
import { Skeleton } from "@/ui/skeleton"
import { TabbedHeader } from "@/ui/tabbed-header"
import { Tabs, TabsContent } from "@/ui/tabs"
import { toast } from "@/ui/sonner"
import { deleteOutboxEvent, fetchInbound, fetchIntegrations, fetchOutbox, fetchOutboxSummary, type InboundRow, type OutboxRow } from "../api"
import { MessageStats, MessageInfo, MessageRow, ReplyList, StatusFilters, WhatsAppStatus } from "../components/CentralParts"
import { MessageBookingDialog, MessageDetail } from "../components/MessageBookingDialog"
import { NotificationsPanel } from "../components/NotificationsPanel"
import { eventLabel, matchesFilter, type StatusFilter } from "../domain"

const TABS = [{ value: "mensagens", label: "Mensagens" }, { value: "notificacoes", label: "Notificações" }] as const
type TabId = (typeof TABS)[number]["value"]
const isTab = (v: string | null): v is TabId => TABS.some((t) => t.value === v)
const DESCRIPTION = "Acompanhe confirmações, avisos e respostas dos seus clientes."

/** Central de mensagens: a aba Mensagens (fila, envios, respostas) e a aba Notificações (o que é enviado, canais e consentimento). */
export function Messages() {
  const gate = useActiveBarbershop()
  const [params, setParams] = useSearchParams()
  const tab: TabId = isTab(params.get("aba")) ? (params.get("aba") as TabId) : "mensagens"
  const setTab = (value: string) => setParams((cur) => { const next = new URLSearchParams(cur); next.set("aba", value); return next }, { replace: true })
  const manager = gate.state === "ready" && gate.canManage
  return (
    <Tabs value={tab} onValueChange={setTab} className="contents">
      <CatalogFrame title="Central de mensagens" description={DESCRIPTION} full header={<TabbedHeader photo={false} name="mensagens" icon={MessageSquare} title="Central de mensagens" description={DESCRIPTION} tabs={manager ? TABS : undefined} />}>
        <ShopGate gate={gate}>
          {(shop, canManage) =>
            canManage ? (
              <>
                <TabsContent value="mensagens"><Panels shop={shop} /></TabsContent>
                <TabsContent value="notificacoes"><NotificationsPanel shop={shop} /></TabsContent>
              </>
            ) : <Panel><EmptyState title="Área da gestão" description="Só o proprietário e o gerente acompanham os envios." /></Panel>
          }
        </ShopGate>
      </CatalogFrame>
    </Tabs>
  )
}

function DeleteMessageDialog({ message, shopId, onClose }: { message: OutboxRow | null; shopId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => deleteOutboxEvent(id),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["outbox", shopId] }), queryClient.invalidateQueries({ queryKey: ["outbox-summary", shopId] })])
      toast.success("Mensagem apagada.")
      onClose()
    },
    onError: (e) => setError((e as { message?: string })?.message?.includes("in_flight") ? "Esta mensagem está sendo enviada agora. Tente em instantes." : "Não foi possível apagar. Tente novamente."),
  })
  const b = message?.bookings
  return (
    <Dialog open={Boolean(message)} onOpenChange={(o) => { if (!o) { setError(null); onClose() } }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-[420px] bg-card">
        <div className="flex flex-col gap-1.5 pr-8 text-left">
          <DialogTitle className="font-display text-xl font-bold tracking-wide">Apagar mensagem?</DialogTitle>
          <DialogDescription>
            {b ? `A mensagem de ${b.cliente_nome} (${eventLabel(message!.tipo)}) e todos os seus registros de envio serão apagados.` : "A mensagem e todos os seus registros de envio serão apagados."} A reserva e o financeiro não são alterados. Não dá para desfazer.
          </DialogDescription>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" className="h-11 md:h-10" onClick={onClose}>Manter</Button>
          <Button className="h-11 bg-danger text-white hover:bg-danger/90 md:h-10" disabled={remove.isPending} onClick={() => message && remove.mutate(message.id)}>{remove.isPending ? "Apagando…" : "Apagar"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}


function Panels({ shop }: { shop: MyBarbershop }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<OutboxRow | null>(null)
  const [filter, setFilter] = useState<StatusFilter>("todas")
  const wide = useMediaQuery("(min-width: 1280px)") // painel lateral no desktop; pop-up no tablet e no celular
  const tz = shop.fuso ?? "America/Sao_Paulo"
  const summary = useQuery({ queryKey: ["outbox-summary", shop.id], queryFn: () => fetchOutboxSummary(shop.id) })
  const outbox = useQuery({ queryKey: ["outbox", shop.id], queryFn: () => fetchOutbox(shop.id) })
  const inbound = useQuery({ queryKey: ["inbound", shop.id], queryFn: () => fetchInbound(shop.id) })
  const integrations = useQuery({ queryKey: ["integrations", shop.id], queryFn: () => fetchIntegrations(shop.id) })

  const failed = [summary, outbox, inbound, integrations].find((q) => q.isError)
  if (failed) {
    if (isMissingSchema(failed.error)) return <EmptyState title="Mensagens indisponíveis" description="O módulo de mensagens ainda está sendo preparado no banco de dados." />
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm font-semibold">Não foi possível carregar as mensagens</p>
        <Button variant="outline" className="h-11 md:h-10" onClick={() => { void summary.refetch(); void outbox.refetch(); void inbound.refetch(); void integrations.refetch() }}>Tentar novamente</Button>
      </div>
    )
  }
  if (!summary.data || !outbox.data || !inbound.data || !integrations.data) {
    return <div role="status" aria-label="Carregando mensagens" className="flex flex-col gap-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
  }

  const whatsapp = integrations.data.find((i) => i.provider === "whatsapp")?.status ?? "nao_configurado"
  const total = (status: string) => summary.data.find((s) => s.status === status)?.total ?? 0
  const repliesByBooking = new Map<string, InboundRow>()
  for (const r of inbound.data) if (r.booking_id && !repliesByBooking.has(r.booking_id)) repliesByBooking.set(r.booking_id, r) // já vem da mais nova para a mais antiga
  const shown = outbox.data.filter((m) => matchesFilter(m.status, filter))
  const selected = outbox.data.find((m) => m.id === selectedId) ?? null
  const replyOf = (m: OutboxRow | null) => (m?.bookings ? repliesByBooking.get(m.bookings.id) ?? null : null)

  return (
    <>
      <WhatsAppStatus status={whatsapp} />
      <MessageStats total={total} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,13fr)_minmax(360px,7fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby="mensagens" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="mensagens" className="font-display text-xl font-semibold tracking-wide">Mensagens</h2>
              <StatusFilters rows={outbox.data} value={filter} onChange={setFilter} />
            </div>
            {outbox.data.length === 0 ? (
              <Panel><EmptyState title="Nenhuma mensagem ainda" description="Os avisos aparecem aqui quando houver reservas com autorização do cliente." /></Panel>
            ) : shown.length === 0 ? (
              <Panel><EmptyState title="Nenhuma mensagem neste estado" description="Escolha outro filtro para ver as demais." /></Panel>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Mensagens">
                {shown.map((m) => (
                  <MessageRow key={m.id} message={m} tz={tz} selected={wide && m.id === selectedId} reply={m.bookings ? repliesByBooking.get(m.bookings.id) : undefined}
                    onSelect={() => setSelectedId(m.id)} onDelete={() => setRemoving(m)} />
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="respostas" className="flex flex-col gap-3">
            <h2 id="respostas" className="font-display text-xl font-semibold tracking-wide">Respostas recebidas</h2>
            <Panel><ReplyList items={inbound.data} tz={tz} active={whatsapp === "ativo"} /></Panel>
          </section>
        </div>

        {wide && (
          <aside aria-label="Detalhes da mensagem" className="sticky top-0 flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-sm sm:p-5">
            {selected ? (
              selected.bookings
                ? <MessageDetail key={selected.id} message={selected} booking={selected.bookings} shopId={shop.id} tz={tz} variant="painel" reply={replyOf(selected)} onClose={() => setSelectedId(null)} />
                : <MessageInfo message={selected} tz={tz} />
            ) : (
              <EmptyState title="Selecione uma mensagem" description="Os detalhes da reserva, o pagamento e as ações (reagendar, pagamento e cancelar) aparecem aqui." />
            )}
          </aside>
        )}
      </div>

      {!wide && <MessageBookingDialog message={selected?.bookings ? selected : null} shopId={shop.id} tz={tz} reply={replyOf(selected)} onClose={() => setSelectedId(null)} />}
      {!wide && selected && !selected.bookings && (
        <Dialog open onOpenChange={(o) => !o && setSelectedId(null)}>
          <DialogContent className="w-[calc(100%-2rem)] max-w-[480px] bg-card">
            <DialogTitle className="sr-only">{eventLabel(selected.tipo)}</DialogTitle>
            <DialogDescription className="sr-only">Detalhes da mensagem</DialogDescription>
            <MessageInfo message={selected} tz={tz} />
          </DialogContent>
        </Dialog>
      )}
      <DeleteMessageDialog message={removing} shopId={shop.id} onClose={() => { if (removing && removing.id === selectedId) setSelectedId(null); setRemoving(null) }} />
    </>
  )
}
