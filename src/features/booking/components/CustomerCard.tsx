import { BellRing, CalendarClock, Check, Megaphone, X } from "lucide-react"
import { formatPhone } from "@/lib/br"
import { cn } from "@/lib/utils"
import { StatusBadge } from "@/ui/finance"
import { WhatsAppIcon, whatsAppWebUrl } from "@/ui/whatsapp-icon"
import { formatPrice } from "@/features/catalog/domain"
import { formatDay, formatTime, localDate, type Customer } from "../domain"

const initials = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("")

function Consent({ icon: Icon, label, value }: { icon: typeof BellRing; label: string; value: boolean | null }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="text-muted-foreground">{label}</span>
      {value === null ? (
        <span className="text-muted-foreground">sem resposta</span>
      ) : (
        <StatusBadge variant={value ? "income" : "default"}>
          <span className="inline-flex items-center gap-1">{value ? <Check className="h-3 w-3" aria-hidden="true" /> : <X className="h-3 w-3" aria-hidden="true" />}{value ? "Aceitou" : "Não aceitou"}</span>
        </StatusBadge>
      )}
    </li>
  )
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "income" | "danger" | "warning" }) {
  return (
    <div className="flex min-w-20 flex-col rounded-xl border border-border bg-surface-alt/60 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("font-display text-xl leading-6 font-bold tabular-nums", tone === "income" && "text-income", tone === "danger" && "text-danger", tone === "warning" && "text-warning")}>{value}</span>
    </div>
  )
}

/**
 * Cartão de um cliente: WhatsApp com o logotipo oficial (abre o WhatsApp Web), os dois termos aceitos na reserva
 * (base para os avisos automáticos), quantas reservas confirmou, cancelou e faltou, e o próximo agendamento.
 * `novidades` é o consentimento vigente (customer_consents); `showConsents` só para a gestão.
 */
export function CustomerCard({ customer: c, tz, novidades, showConsents }: { customer: Customer; tz: string; novidades: boolean | null; showConsents: boolean }) {
  return (
    <li className="flex flex-col gap-4 rounded-card border border-border bg-card p-4 shadow-sm sm:p-5 lg:flex-row lg:items-start lg:gap-6">
      <div className="flex min-w-0 flex-1 gap-4">
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-lg font-bold text-primary">{initials(c.nome)}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="min-w-0">
            <p className="truncate font-display text-xl font-semibold tracking-wide">{c.nome}</p>
            <a
              href={whatsAppWebUrl(c.whatsapp)} target="_blank" rel="noopener noreferrer"
              aria-label={`Abrir conversa no WhatsApp Web com ${c.nome}: ${formatPhone(c.whatsapp)}`}
              className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium tabular-nums underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:min-h-0"
            >
              <WhatsAppIcon className="h-5 w-5" />
              {formatPhone(c.whatsapp)}
            </a>
          </div>
          {showConsents && (
            <ul aria-label="Termos aceitos" className="flex flex-col gap-1.5">
              <Consent icon={BellRing} label="Avisos e lembretes da reserva" value={c.avisos} />
              <Consent icon={Megaphone} label="Novidades e promoções" value={novidades} />
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:w-[380px] lg:shrink-0">
        <div className="flex flex-wrap gap-2">
          <Stat label="Confirmadas" value={c.confirmados} tone="income" />
          <Stat label="Concluídas" value={c.concluidos} />
          <Stat label="Canceladas" value={c.cancelados} tone={c.cancelados > 0 ? "danger" : undefined} />
          <Stat label="Faltas" value={c.faltas} tone={c.faltas > 0 ? "warning" : undefined} />
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-alt/60 px-3 py-2.5">
          <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 text-sm">
            <p className="text-xs text-muted-foreground">Próximo agendamento</p>
            {c.proxima ? (
              <p className="font-semibold tabular-nums">
                {formatDay(localDate(c.proxima, tz), "curto")} · {formatTime(c.proxima, tz)}{c.proximaServico ? ` · ${c.proximaServico}` : ""}
              </p>
            ) : (
              <p className="text-muted-foreground">Nenhum agendamento marcado</p>
            )}
            {c.gasto > 0 && <p className="text-xs text-muted-foreground">{formatPrice(c.gasto)} em atendimentos concluídos{c.ultimo ? ` · último em ${formatDay(localDate(c.ultimo, tz), "curto")}` : ""}</p>}
          </div>
        </div>
      </div>
    </li>
  )
}
