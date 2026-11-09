import { AlertTriangle, Ban, CalendarDays, Check, CheckCheck, CircleSlash, Clock, Loader2, MessageSquareReply, Send, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { StatusBadge } from "@/ui/finance"
import { WhatsAppIcon } from "@/ui/whatsapp-icon"
import { formatDateTime } from "@/features/booking/domain"
import type { InboundRow, OutboxRow } from "../api"
import { channelLabel, eventLabel, inboundReasonLabel, maskPhone, matchesFilter, outboxReasonLabel, replyKind, sendLabel, STATUS_FILTERS, whatsappState, type StatusFilter } from "../domain"

type Tone = "info" | "income" | "danger" | "warning" | "default"
const TONE_TEXT: Record<Tone, string> = { info: "text-info", income: "text-income", danger: "text-danger", warning: "text-warning", default: "text-muted-foreground" }
const TONE_BG: Record<Tone, string> = { info: "bg-info/10", income: "bg-income/10", danger: "bg-danger/10", warning: "bg-warning/10", default: "bg-surface-alt" }
const SEND_UI: Record<string, { icon: typeof Clock; tone: Tone }> = {
  pendente: { icon: Clock, tone: "info" }, enviando: { icon: Loader2, tone: "info" }, enviado: { icon: CheckCheck, tone: "income" },
  falhou: { icon: AlertTriangle, tone: "danger" }, bloqueado: { icon: Ban, tone: "warning" }, cancelado: { icon: CircleSlash, tone: "default" },
}

/** Faixa do canal WhatsApp: mostra o estado REAL da integração. Sem botão de conectar (a ativação é no servidor). */
export function WhatsAppStatus({ status }: { status: string }) {
  const { title, text, label, variant, active } = whatsappState(status)
  return (
    <section aria-label="Canal WhatsApp" className={cn("flex items-center gap-4 rounded-card border px-4 py-3", active ? "border-income/40 bg-income/5" : "border-warning/40 bg-warning/5")}>
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-card", !active && "grayscale")}><WhatsAppIcon className="h-6 w-6" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      <StatusBadge variant={variant}>{label}</StatusBadge>
    </section>
  )
}

/** Quatro contadores do que existe na fila. Números reais (função de resumo do banco), nada simulado. */
export function MessageStats({ total }: { total: (status: string) => number }) {
  const items = [
    { status: "pendente", label: "Na fila", icon: Clock, tone: "info" as Tone },
    { status: "enviado", label: "Enviadas", icon: CheckCheck, tone: "income" as Tone },
    { status: "falhou", label: "Falhas", icon: AlertTriangle, tone: "danger" as Tone },
    { status: "bloqueado", label: "Bloqueadas", icon: Ban, tone: "warning" as Tone },
  ]
  return (
    <ul aria-label="Resumo dos envios" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map(({ status, label, icon: Icon, tone }) => (
        <li key={status} className="flex items-center gap-3 rounded-card border border-border bg-card px-3.5 py-3 shadow-sm">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", TONE_BG[tone], TONE_TEXT[tone])}><Icon className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="font-display text-2xl leading-7 font-bold tabular-nums">{total(status)}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function StatusFilters({ rows, value, onChange }: { rows: OutboxRow[]; value: StatusFilter; onChange: (value: StatusFilter) => void }) {
  return (
    <div role="group" aria-label="Filtrar por estado do envio" className="flex flex-wrap gap-2">
      {STATUS_FILTERS.filter((f) => f.id === "todas" || rows.some((r) => matchesFilter(r.status, f.id)) || value === f.id).map((f) => {
        const count = f.id === "todas" ? rows.length : rows.filter((r) => matchesFilter(r.status, f.id)).length
        return (
          <button key={f.id} type="button" aria-pressed={value === f.id} onClick={() => onChange(f.id)}
            className={cn("min-h-10 rounded-lg border px-3 text-sm font-medium transition-colors", value === f.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-foreground/5")}>
            {f.label} ({count})
          </button>
        )
      })}
    </div>
  )
}

/** Linha da lista: quem, o quê, quando e o estado real do envio. Selecionar abre os detalhes. */
export function MessageRow({ message: m, tz, selected, reply, onSelect, onDelete }: {
  message: OutboxRow; tz: string; selected: boolean; reply: InboundRow | undefined; onSelect: () => void; onDelete: () => void
}) {
  const b = m.bookings
  const ui = SEND_UI[m.status] ?? SEND_UI.cancelado
  const Icon = ui.icon
  const Channel = m.canal === "whatsapp" ? WhatsAppIcon : CalendarDays
  const kind = reply ? replyKind(reply.motivo, reply.status) : null
  const body = (
    <>
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", TONE_BG[ui.tone], TONE_TEXT[ui.tone])}><Icon className={cn("h-5 w-5", m.status === "enviando" && "animate-spin")} aria-hidden="true" /></span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-base font-semibold">{b ? b.cliente_nome : eventLabel(m.tipo)}</span>
          <Channel className="h-4 w-4 shrink-0" aria-label={channelLabel(m.canal)} />
        </span>
        <span className="truncate text-sm text-muted-foreground">{eventLabel(m.tipo)}{b ? ` · ${b.servico_nome}` : ""}</span>
        <span className="truncate text-xs text-muted-foreground tabular-nums">
          {b ? formatDateTime(b.inicio, tz) : `${channelLabel(m.canal)}${m.canal === "whatsapp" ? ` · ${maskPhone(m.destino)}` : ""} · ${formatDateTime(m.criado_em, tz)}`}
          {m.tentativas > 0 ? ` · tentativa ${m.tentativas}/${m.max_tentativas}` : ""}
        </span>
        {m.ultimo_erro && <span className="truncate text-xs text-muted-foreground">{outboxReasonLabel(m.ultimo_erro)}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5 pr-9">
        <StatusBadge variant={ui.tone}>{sendLabel(m.status)}</StatusBadge>
        {kind && (
          <span className={cn("inline-flex items-center gap-1 text-xs font-medium", kind === "confirmou" ? "text-income" : kind === "cancelou" ? "text-danger" : "text-muted-foreground")}>
            <MessageSquareReply className="h-3.5 w-3.5" aria-hidden="true" />
            {kind === "confirmou" ? "Confirmou" : kind === "cancelou" ? "Cancelou" : "Respondeu"}
          </span>
        )}
      </span>
    </>
  )
  const base = "flex w-full items-center gap-3 rounded-xl border p-3 transition-colors"
  return (
    <li className="relative flex">
      {b ? (
        <button type="button" onClick={onSelect} aria-pressed={selected} aria-label={`Abrir reserva de ${b.cliente_nome}, ${b.servico_nome}`}
          className={cn(base, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", selected ? "border-primary/70 bg-primary/10" : "border-border bg-card hover:bg-foreground/5")}>{body}</button>
      ) : (
        <button type="button" onClick={onSelect} aria-pressed={selected} aria-label={`Abrir mensagem ${eventLabel(m.tipo)}`}
          className={cn(base, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", selected ? "border-primary/70 bg-primary/10" : "border-border bg-card hover:bg-foreground/5")}>{body}</button>
      )}
      <button type="button" onClick={onDelete} aria-label={`Apagar mensagem${b ? ` de ${b.cliente_nome}` : ""}`}
        className="absolute right-2.5 bottom-2.5 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <Trash2 className="size-4" aria-hidden="true" />
      </button>
    </li>
  )
}

/** Respostas dos clientes, separadas por tipo: confirmou (SIM), cancelou (NÃO) e as demais (ignoradas ou rejeitadas, com o motivo). */
export function ReplyList({ items, tz, active }: { items: InboundRow[]; tz: string; active: boolean }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
        <MessageSquareReply className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-base font-semibold">Nenhuma resposta</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {active ? "Respostas SIM ou NÃO aos avisos aparecem aqui." : "As respostas só chegam depois que o WhatsApp for ativado no servidor."}
        </p>
      </div>
    )
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((i) => {
        const kind = replyKind(i.motivo, i.status)
        const Icon = kind === "confirmou" ? Check : kind === "cancelou" ? X : CircleSlash
        const tone: Tone = kind === "confirmou" ? "income" : kind === "cancelou" ? "danger" : "default"
        return (
          <li key={i.id} className="flex items-center gap-3 px-4 py-3">
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", TONE_BG[tone], TONE_TEXT[tone])}><Icon className="h-4 w-4" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base">{inboundReasonLabel(i.motivo) || "Sem detalhes"}</p>
              <p className="text-sm text-muted-foreground">{formatDateTime(i.recebido_em, tz)}</p>
            </div>
            <StatusBadge variant={i.status === "processado" ? "income" : i.status === "rejeitado" ? "danger" : "default"}>
              {i.status === "processado" ? "Aplicada" : i.status === "rejeitado" ? "Rejeitada" : "Ignorada"}
            </StatusBadge>
          </li>
        )
      })}
    </ul>
  )
}

/** Detalhe de uma mensagem sem reserva (ex.: evento de calendário). */
export function MessageInfo({ message: m, tz }: { message: OutboxRow; tz: string }) {
  const rows: [string, string][] = [
    ["Tipo", eventLabel(m.tipo)], ["Canal", channelLabel(m.canal)], ...(m.canal === "whatsapp" ? [["Destino", maskPhone(m.destino)] as [string, string]] : []),
    ["Estado", sendLabel(m.status)], ["Criada", formatDateTime(m.criado_em, tz)], ["Tentativas", `${m.tentativas}/${m.max_tentativas}`],
  ]
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-display text-2xl font-bold tracking-wide">{eventLabel(m.tipo)}</h2>
      <dl className="rounded-card border border-border px-4">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 border-b border-border py-2 text-sm last:border-0"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>
        ))}
      </dl>
      {m.ultimo_erro && <p className="text-sm text-muted-foreground">{outboxReasonLabel(m.ultimo_erro)}</p>}
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><Send className="h-4 w-4" aria-hidden="true" />Só vira "Enviada" quando o provedor confirmar o envio.</p>
    </div>
  )
}
