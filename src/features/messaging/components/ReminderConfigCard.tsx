import { Clock, Loader2, MessageSquare } from "lucide-react"
import { useActiveBarbershop } from "@/features/catalog/hooks/useActiveBarbershop"
import { formatDateTime } from "@/features/booking/domain"
import { Toggle } from "@/ui/toggle"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/ui/select"
import { Panel } from "@/ui/finance"
import { useReminderConfig } from "../useReminderConfig"
import { useMessageTemplates } from "../useMessageTemplates"
import { MESSAGE_VARIABLES, messageVariables } from "../../../../supabase/functions/_shared/messages"
import { MessageTemplateEditor } from "./MessageTemplateEditor"
import { reminderSendAt, safeFormat } from "../domain"

const LEAD_TIME_OPTIONS = [
  { value: 15, label: "15 minutos" },
  { value: 30, label: "30 minutos" },
  { value: 60, label: "1 hora" },
  { value: 120, label: "2 horas" },
] as const

/** Exemplo de dados para prévia */
const PREVIEW_EXAMPLE = {
  cliente_nome: "João Silva",
  servico_nome: "Corte + Barba",
  profissional_nome: "Carlos Barbosa",
  inicio: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // daqui a 2h
  barbearia_nome: "Barbearia Exemplo",
  endereco: "Rua das Flores, 123 - Centro",
  fuso: "America/Sao_Paulo",
}

/** `parte`: só a confirmação ou só o lembrete (Notificações põe cada um numa coluna); sem ela, os dois. */
export function ReminderConfigCard({ shop, parte }: { shop: { id: string; nome: string; fuso: string }; parte?: "confirmacao" | "lembrete" }) {
  const gate = useActiveBarbershop()
  const activeShop = gate.state === "ready" ? gate.active : null
  const tz = activeShop?.fuso ?? shop.fuso ?? "America/Sao_Paulo"

  const { config, saving, change: handleChange } = useReminderConfig(shop.id)

  const leadTimeLabel = LEAD_TIME_OPTIONS.find(o => o.value === config.lead_time_minutes)?.label ?? "30 minutos"
  const previewTime = PREVIEW_EXAMPLE.inicio
  const reminderDateTime = safeFormat(reminderSendAt(previewTime, config.lead_time_minutes), (iso) => formatDateTime(iso, tz))
  const textos = useMessageTemplates(shop.id)
  // Valores de exemplo das variáveis, com o nome real da barbearia e a antecedência escolhida
  let exemplo: Record<string, string>
  try {
    exemplo = messageVariables({
      cliente: PREVIEW_EXAMPLE.cliente_nome, servico: PREVIEW_EXAMPLE.servico_nome, profissional: PREVIEW_EXAMPLE.profissional_nome,
      inicio: previewTime, fuso: tz, barbearia: shop.nome, endereco: PREVIEW_EXAMPLE.endereco, lead_time_minutes: config.lead_time_minutes,
    })
  } catch {
    exemplo = Object.fromEntries(MESSAGE_VARIABLES.map((v) => [v.chave, v.exemplo]))
  }

  return (
    <div className="space-y-6">
      {/* Configuração de Confirmação Automática */}
      {parte !== "lembrete" && (
      <Panel className="rounded-card border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MessageSquare className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-display text-base font-bold tracking-wide">Confirmação automática</p>
              <p className="text-xs text-muted-foreground">
                Envia mensagem quando a reserva for confirmada (pelo cliente via WhatsApp ou pela equipe).
              </p>
            </div>
          </div>
          <Toggle
            pressed={config.auto_confirmation}
            onPressedChange={(pressed) => handleChange("auto_confirmation", pressed)}
            disabled={saving}
            aria-label="Ativar confirmação automática"
            className="h-10 w-10 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          />
        </div>
        <MessageTemplateEditor
          tipo="confirmacao"
          titulo="Confirmação da reserva"
          icon={<MessageSquare className="h-4 w-4 text-income" />}
          salvo={textos.templates.confirmacao}
          exemplo={exemplo}
          podeSalvar={textos.templates.supported}
          salvando={textos.saving}
          onSalvar={(texto) => textos.save("confirmacao", texto)}
        />
      </Panel>

      )}

      {/* Configuração de Lembrete Automático */}
      {parte !== "confirmacao" && (
      <Panel className="rounded-card border border-border bg-card p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-[200px]">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Clock className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="font-display text-base font-bold tracking-wide">Lembrete automático</p>
              <p className="text-xs text-muted-foreground">
                Envia aviso antes do horário do atendimento. Respeita o consentimento do cliente.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Select
              value={String(config.lead_time_minutes)}
              onValueChange={(v) => handleChange("lead_time_minutes", Number(v))}
              disabled={!config.auto_reminder || saving}
            >
              <SelectTrigger className="w-[140px] h-9 text-sm" aria-label="Antecedência do lembrete">
                <span className="truncate flex items-center">
                  {LEAD_TIME_OPTIONS.find(o => o.value === config.lead_time_minutes)?.label ?? "Antecedência"}
                </span>
              </SelectTrigger>
              <SelectContent>
                {LEAD_TIME_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Toggle
              pressed={config.auto_reminder}
              onPressedChange={(pressed) => handleChange("auto_reminder", pressed)}
              disabled={saving}
              aria-label="Ativar lembrete automático"
              className="h-10 w-10 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            />
          </div>
        </div>
        <MessageTemplateEditor
          tipo="lembrete"
          titulo={`Lembrete (${leadTimeLabel} antes)`}
          icon={<Clock className="h-4 w-4 text-warning" />}
          salvo={textos.templates.lembrete}
          exemplo={exemplo}
          meta={reminderDateTime ? `No exemplo, seria enviado em: ${reminderDateTime}` : undefined}
          podeSalvar={textos.templates.supported}
          salvando={textos.saving}
          onSalvar={(texto) => textos.save("lembrete", texto)}
        />
      </Panel>
      )}

      {saving && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Salvando…
        </div>
      )}
    </div>
  )
}
