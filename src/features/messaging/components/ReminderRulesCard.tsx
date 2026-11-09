import { useQuery } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
import { Panel } from "@/ui/finance"
import { fetchIntegrations } from "../api"

/** Regras de confirmação e lembrete (cancelamento, reagendamento, horário vencido, canal e isolamento). */
export function ReminderRulesCard({ shop }: { shop: { id: string; nome: string } }) {
  const { data: integrations } = useQuery({ queryKey: ["integrations", shop.id], queryFn: () => fetchIntegrations(shop.id), staleTime: 30000 })
  const whatsappActive = integrations?.some((i) => i.provider === "whatsapp" && i.status === "ativo")
  const regra = "font-medium text-foreground min-w-[140px] flex-shrink-0"

  return (
    <section aria-label="Regras dos avisos">
    <Panel className="rounded-card border border-border bg-card p-5">
      <dl className="space-y-2 text-sm text-muted-foreground">
        <div className="flex gap-3">
          <dt className={regra}>Cancelamento:</dt>
          <dd>Invalida automaticamente o lembrete agendado.</dd>
        </div>
        <div className="flex gap-3">
          <dt className={regra}>Reagendamento:</dt>
          <dd>Atualiza o horário do lembrete para o novo horário.</dd>
        </div>
        <div className="flex gap-3">
          <dt className={regra}>Horário vencido:</dt>
          <dd>Sai a partir da antecedência escolhida e até o início do atendimento; depois que começa, não é enviado.</dd>
        </div>
        <div className="flex gap-3">
          <dt className={regra}>WhatsApp:</dt>
          <dd className={cn(whatsappActive ? "text-income" : "text-warning")}>
            {whatsappActive ? <>Ativo — mensagens serão entregues.</> : <>Não configurado — mensagens ficam bloqueadas até ativar.</>}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className={regra}>Isolamento:</dt>
          <dd>Configurações válidas apenas para <strong>{shop.nome}</strong>.</dd>
        </div>
      </dl>
    </Panel>
    </section>
  )
}
