import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bot, Loader2, Send, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { FIELD } from "@/ui/settings-card"
import { askAssistant, fetchAiConnection, type ChatMessage } from "../ai-api"

const ERRORS: Record<string, string> = {
  no_key: "Conecte uma chave de IA para conversar com a Lara.",
  key_rejected: "O provedor recusou a chave salva. Troque a chave em Configurações › Assistente.",
  rate_limited: "O provedor limitou o uso agora ou a conta está sem crédito. Tente mais tarde.",
  provider_error: "O provedor de IA não respondeu. Tente de novo.",
  forbidden: "Só o proprietário e o gerente usam a Lara.",
}
const errorText = (e: unknown) => ERRORS[(e as Error | null)?.message ?? ""] ?? "Não foi possível responder agora. Tente de novo."
/** Atalhos do primeiro uso: o rótulo curto vira a pergunta completa. */
const SUGGESTIONS = [
  { label: "Agenda de hoje", question: "Quais os agendamentos de hoje?" },
  { label: "Horários livres amanhã", question: "Quais horários estão livres amanhã?" },
  { label: "Previsto da semana", question: "Quanto está previsto de faturamento nesta semana?" },
]
/** Conversa guardada no cache da sessão: a mesma no botão flutuante e em Configurações, e não some ao trocar de tela. */
const chatKey = (shopId: string) => ["lara-chat", shopId]
const BUBBLE = "max-w-[85%] whitespace-pre-wrap px-3.5 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere]"

/**
 * Chat da Lara (gestão): consulta agenda, horários livres e faturamento da barbearia com a chave de IA já salva.
 * `onClose` = versão flutuante (botão de fechar, foco no campo e atalho para conectar a chave).
 */
export function AssistantChat({ shopId, className, onClose }: { shopId: string; className?: string; onClose?: () => void }) {
  const queryClient = useQueryClient()
  const connection = useQuery({ queryKey: ["ai-connection", shopId], queryFn: () => fetchAiConnection(shopId), retry: false }) // mesmo cache do AiKeyCard
  const { data: messages } = useQuery<ChatMessage[]>({ queryKey: chatKey(shopId), queryFn: () => [], initialData: [], staleTime: Infinity, gcTime: Infinity })
  const [text, setText] = useState("")
  const ask = useMutation({
    mutationFn: (next: ChatMessage[]) => askAssistant(shopId, next),
    onSuccess: (resposta, next) => queryClient.setQueryData<ChatMessage[]>(chatKey(shopId), [...next, { role: "assistant", content: resposta }]),
    onError: (_e, next) => setText(next[next.length - 1].content), // a pergunta volta ao campo para tentar de novo
  })
  const shown = ask.isPending && ask.variables ? ask.variables : messages
  const connected = Boolean(connection.data)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => { scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight }) }, [shown.length, ask.isPending])

  const send = (content: string) => {
    const question = content.trim()
    if (!question || ask.isPending) return
    setText("")
    ask.mutate([...messages, { role: "user", content: question }])
  }

  return (
    <section aria-labelledby="lara-titulo" className={cn("flex h-[min(580px,calc(100dvh-9rem))] min-w-0 flex-col overflow-hidden rounded-card border border-border bg-card", className)}>
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span aria-hidden="true" className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Bot className="h-[18px] w-[18px]" />
          {connected && <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-income" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="lara-titulo" className="font-display text-lg leading-tight font-bold tracking-wide">Lara</h2>
          <p className="truncate text-xs text-muted-foreground">{connection.isPending ? "Verificando conexão…" : connected ? "Assistente da barbearia" : "Sem chave de IA conectada"}</p>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" aria-label="Fechar conversa" onClick={onClose} className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </header>

      {connection.isPending ? (
        <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Verificando conexão…</div>
      ) : !connected ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="max-w-[32ch] text-sm text-muted-foreground">Conecte uma chave de IA em Configurações › Assistente para conversar com a Lara.</p>
          {onClose && <Button asChild variant="outline" className="h-10"><Link to="/configuracoes" onClick={onClose}>Conectar chave</Link></Button>}
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
            <ol aria-label="Conversa com a Lara" aria-live="polite" className="flex min-h-full flex-col justify-end gap-2.5">
              {shown.length === 0 && (
                <li className="flex flex-col items-start gap-3">
                  <p className={cn(BUBBLE, "rounded-2xl rounded-bl-md bg-surface-alt text-foreground")}>Oi! Sou a Lara. Consulto a agenda, os horários livres e o faturamento da barbearia. Por onde começamos?</p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => send(s.question)}
                        className="h-8 rounded-full border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </li>
              )}
              {shown.map((m, i) => (
                <li
                  key={i}
                  className={cn(BUBBLE, m.role === "user" ? "self-end rounded-2xl rounded-br-md bg-primary text-primary-foreground" : "self-start rounded-2xl rounded-bl-md bg-surface-alt text-foreground")}
                >
                  <span className="sr-only">{m.role === "user" ? "Você: " : "Lara: "}</span>{m.content}
                </li>
              ))}
              {ask.isPending && (
                <li role="status" className="flex items-center gap-2.5 self-start rounded-2xl rounded-bl-md bg-surface-alt px-3.5 py-3">
                  <span aria-hidden="true" className="flex gap-1">
                    {[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${d * 150}ms` }} />)}
                  </span>
                  <span className="text-xs text-muted-foreground">Consultando os dados…</span>
                </li>
              )}
            </ol>
          </div>
          {ask.isError && <p role="alert" className="mx-3 mb-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">{errorText(ask.error)}</p>}
          <form className="flex items-center gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); send(text) }}>
            <Input aria-label="Pergunta para a Lara" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Pergunte à Lara…" autoFocus={Boolean(onClose)} className={FIELD} />
            <Button type="submit" size="icon" aria-label="Enviar" className="h-11 w-11 shrink-0 md:h-10 md:w-10" disabled={ask.isPending || !text.trim()}><Send className="h-4 w-4" aria-hidden="true" /></Button>
          </form>
        </>
      )}
    </section>
  )
}
