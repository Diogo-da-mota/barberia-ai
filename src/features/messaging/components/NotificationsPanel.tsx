import { useQuery } from "@tanstack/react-query"
import { Bell, Mail, Send } from "lucide-react"
import type { MyBarbershop } from "@/features/home/domain"
import { SettingsCard } from "@/ui/settings-card"
import { StatusBadge } from "@/ui/finance"
import { Skeleton } from "@/ui/skeleton"
import { WhatsAppIcon } from "@/ui/whatsapp-icon"
import { fetchIntegrations } from "../api"
import { whatsappState } from "../domain"
import { WhatsAppConnect, WhatsAppStateBadge } from "@/features/settings/components/WhatsAppConnect"
import { useWhatsAppConnection } from "@/features/settings/useWhatsAppConnection"
import { Switch } from "@/ui/switch"
import { useReminderConfig } from "../useReminderConfig"
import { ReminderRulesCard } from "./ReminderRulesCard"
import { ReturnMessageCard } from "./ReturnMessageCard"
import { useReturnSettings } from "../useReturnSettings"
import { ReminderConfigCard } from "./ReminderConfigCard"

/**
 * Mensagens que o sistema gera para o cliente. `campo`: chave real em barbershops.reminder_config (a mesma dos cards abaixo).
 * Sem `campo`, o aviso ainda não sai pelo WhatsApp (o workflow entrega só confirmações e lembretes): chave desligada e bloqueada.
 */
const CLIENT_MESSAGES: { nome: string; texto: string; campo?: "auto_confirmation" | "auto_reminder" | "retorno" }[] = [
  { nome: "Confirmação da reserva", texto: "Quando a reserva é confirmada.", campo: "auto_confirmation" },
  { nome: "Cancelamento", texto: "Quando a reserva é cancelada." },
  { nome: "Reagendamento", texto: "Quando o horário da reserva muda." },
  { nome: "Atendimento concluído", texto: "Depois que o atendimento é concluído." },
  { nome: "Lembrete automático", texto: "No horário configurado antes do atendimento.", campo: "auto_reminder" },
  { nome: "Retorno do cliente", texto: "Quando o cliente fica um tempo sem voltar.", campo: "retorno" },
]

/**
 * Aba Notificações da Central de mensagens: o que é enviado ao cliente, por qual canal e com qual consentimento.
 * O estado do canal vem do mesmo cadastro (integration_accounts) e da mesma definição (`whatsappState`) da faixa da aba Mensagens.
 */
export function NotificationsPanel({ shop }: { shop: MyBarbershop }) {
  const integrations = useQuery({ queryKey: ["integrations", shop.id], queryFn: () => fetchIntegrations(shop.id) })
  const whatsapp = whatsappState(integrations.data?.find((i) => i.provider === "whatsapp")?.status ?? "nao_configurado")
  const shopFuso = shop.fuso ?? "America/Sao_Paulo"
  // o mesmo botão e QR de Mais › WhatsApp (instância Evolution da barbearia)
  const conexao = useWhatsAppConnection(shop.id)
  const avisos = useReminderConfig(shop.id)
  const retorno = useReturnSettings(shop.id)

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] xl:items-start">
      {/* Coluna esquerda: Mensagens ao cliente + Configuração de Lembretes */}
      <div className="space-y-6">
        <SettingsCard icon={Bell} title="Mensagens ao cliente" hint="Avisos que o sistema gera para quem agenda com você.">
          <ul className="flex flex-col divide-y divide-border">
            {CLIENT_MESSAGES.map((m, i) => (
              <li key={m.nome} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{m.nome}</p>
                  <p className="text-xs text-muted-foreground">{m.texto}</p>
                  {!m.campo && <p id={`aviso-cliente-${i}`} className="text-xs text-muted-foreground/80">Ainda não sai pelo WhatsApp.</p>}
                </div>
                {m.campo === "retorno" ? (
                  <Switch checked={retorno.settings.ativo} onCheckedChange={(v) => retorno.change({ ativo: v })} disabled={!retorno.supported || retorno.saving} aria-label="Enviar retorno do cliente automaticamente" />
                ) : m.campo ? (
                  <Switch checked={avisos.config[m.campo]} onCheckedChange={(v) => avisos.change(m.campo as "auto_confirmation" | "auto_reminder", v)} disabled={avisos.saving} aria-label={`Enviar ${m.nome.toLowerCase()} automaticamente`} />
                ) : (
                  <Switch checked={false} disabled aria-label={`${m.nome}: ainda não sai pelo WhatsApp`} aria-describedby={`aviso-cliente-${i}`} />
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Respeitam o consentimento de cada cliente: avisos da reserva e novidades são escolhas separadas,
            e uma preferência comercial nunca desliga um aviso da reserva.
          </p>
        </SettingsCard>

        {/* Nova seção: Configuração de Confirmação e Lembretes */}
        <ReminderConfigCard parte="confirmacao" shop={{ id: shop.id, nome: shop.nome, fuso: shopFuso }} />

        <ReturnMessageCard shop={{ id: shop.id, nome: shop.nome, fuso: shopFuso }} />
      </div>

      {/* Coluna direita: Canais de envio, Lembrete automático e as regras */}
      <div className="flex min-w-0 flex-col gap-6">
        <SettingsCard icon={Send} title="Canais de envio" hint="O estado real de cada integração.">
          <ul className="flex flex-col divide-y divide-border">
            <li className="flex flex-col gap-3 py-3 first:pt-0" aria-label="Canal WhatsApp: conexão">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span aria-hidden="true" className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-alt">
                    <WhatsAppIcon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">WhatsApp</p>
                    <p className="text-xs text-muted-foreground">
                      {integrations.isError ? "Não foi possível consultar o canal." : whatsapp.text}
                    </p>
                  </div>
                </div>
                {integrations.data ? (
                  <StatusBadge variant={whatsapp.variant}>{whatsapp.label}</StatusBadge>
                ) : (
                  <Skeleton className="h-6 w-16" />
                )}
              </div>
              {(conexao.qr || conexao.isConnected) && <WhatsAppStateBadge connection={conexao} />}
              <WhatsAppConnect connection={conexao} compact />
            </li>
            <li className="flex items-start justify-between gap-3 py-3 last:pb-0">
              <div className="flex min-w-0 items-start gap-3">
                <span aria-hidden="true" className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-alt">
                  <Mail className="h-5 w-5 text-muted-foreground" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">E-mail</p>
                  <p className="text-xs text-muted-foreground">
                    Não há integração de e-mail: nenhuma mensagem é enviada por esse canal.
                  </p>
                </div>
              </div>
              <StatusBadge variant="default">Indisponível</StatusBadge>
            </li>
          </ul>
        </SettingsCard>

        <ReminderConfigCard parte="lembrete" shop={{ id: shop.id, nome: shop.nome, fuso: shopFuso }} />

        <ReminderRulesCard shop={{ id: shop.id, nome: shop.nome }} />
      </div>
    </div>
  )
}