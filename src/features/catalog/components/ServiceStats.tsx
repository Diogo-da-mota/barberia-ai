import { BadgeDollarSign, Scissors } from "lucide-react"
import { formatPrice } from "../domain"
import { SALES_DAYS } from "../sales"

const card = "flex min-w-0 items-center gap-3 rounded-card border border-border bg-card p-3.5 shadow-sm"
const icon = "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"

/**
 * Indicadores da tela de serviços, de dados reais. `ticket`: undefined = não mostrar (quem não é da gestão);
 * null = sem dados suficientes; senão o valor recebido por atendimento concluído nos últimos 90 dias.
 */
export function ServiceStats({ active, total, ticket }: { active: number; total: number; ticket: { cents: number; count: number } | null | undefined }) {
  return (
    <section aria-label="Indicadores de serviços" className="grid gap-3 sm:grid-cols-2">
      <div className={card}>
        <span className={icon}><Scissors className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Serviços ativos</p>
          <p className="font-display text-[28px] leading-8 font-bold tabular-nums">{active}</p>
          {total > active && <p className="text-xs text-muted-foreground">de {total} cadastrados</p>}
        </div>
      </div>
      {ticket !== undefined && (
        <div className={card}>
          <span className={icon}><BadgeDollarSign className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Ticket médio</p>
            {ticket ? (
              <>
                <p className="font-display text-[28px] leading-8 font-bold tabular-nums">{formatPrice(ticket.cents)}</p>
                <p className="text-xs text-muted-foreground">{ticket.count} atendimentos concluídos · últimos {SALES_DAYS} dias</p>
              </>
            ) : (
              <>
                <p className="font-display text-xl leading-8 font-semibold text-muted-foreground">Sem dados suficientes</p>
                <p className="text-xs text-muted-foreground">Precisa de atendimentos concluídos com pagamento confirmado nos últimos {SALES_DAYS} dias</p>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
