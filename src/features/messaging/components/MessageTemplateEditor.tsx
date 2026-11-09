import { useRef, useState, type ReactNode } from "react"
import { Clock, RotateCcw, Save } from "lucide-react"
import { DEFAULT_TEMPLATES, MESSAGE_VARIABLES, VARIABLES_BY_TYPE, renderTemplate } from "../../../../supabase/functions/_shared/messages"
import { Button } from "@/ui/button"

const LIMITE = 1000

type Props = {
  tipo: "confirmacao" | "lembrete" | "retorno"
  /** Texto salvo na barbearia (ou o padrão). */
  salvo: string
  /** Valores de exemplo das variáveis para a prévia. */
  exemplo: Record<string, string>
  icon: ReactNode
  titulo: string
  /** Linha extra abaixo da prévia (ex.: quando o lembrete será enviado). */
  meta?: string
  podeSalvar: boolean
  salvando: boolean
  onSalvar: (texto: string) => void
}

/**
 * Editor do texto da mensagem: campo livre, botões que inserem as variáveis no cursor e a prévia montada
 * pela mesma função que o worker usa no envio (renderTemplate). O que aparece aqui é o que o cliente recebe.
 */
export function MessageTemplateEditor({ tipo, salvo, exemplo, icon, titulo, meta, podeSalvar, salvando, onSalvar }: Props) {
  const [texto, setTexto] = useState(salvo)
  const [base, setBase] = useState(salvo)
  // o texto salvo mudou (outra aba, salvamento): acompanha, a menos que haja edição em andamento
  if (salvo !== base) {
    setBase(salvo)
    if (texto === base) setTexto(salvo)
  }
  const campo = useRef<HTMLTextAreaElement>(null)
  const id = `texto-${tipo}`
  const variaveis = MESSAGE_VARIABLES.filter((v) => VARIABLES_BY_TYPE[tipo].includes(v.chave))
  const mudou = texto.trim() !== salvo.trim()
  const invalido = texto.trim().length === 0 || texto.length > LIMITE
  const previa = renderTemplate(texto, exemplo)

  const inserir = (chave: string) => {
    const el = campo.current
    const marca = `{${chave}}`
    const ini = el?.selectionStart ?? texto.length
    const fim = el?.selectionEnd ?? texto.length
    const novo = texto.slice(0, ini) + marca + texto.slice(fim)
    setTexto(novo)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(ini + marca.length, ini + marca.length)
    })
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">Texto da mensagem</label>
        <textarea
          ref={campo}
          id={id}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={4}
          maxLength={LIMITE}
          disabled={!podeSalvar}
          aria-describedby={`${id}-ajuda`}
          className="min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <p id={`${id}-ajuda`}>Clique numa variável para inserir no cursor. *negrito* e _itálico_ funcionam no WhatsApp.</p>
          <span className="tabular-nums">{texto.length}/{LIMITE}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Variáveis">
        {variaveis.map((v) => (
          <button
            key={v.chave}
            type="button"
            onClick={() => inserir(v.chave)}
            disabled={!podeSalvar}
            title={v.rotulo}
            className="inline-flex h-8 items-center rounded-full border border-border bg-muted/50 px-2.5 font-mono text-xs transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          >
            {`{${v.chave}}`}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border/50 bg-card p-4" aria-label={`Prévia: ${titulo}`} role="region">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prévia · {titulo}</p>
            <p data-testid={`previa-${tipo}`} className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{previa || "Prévia indisponível"}</p>
            {meta && (
              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {meta}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" className="h-11 gap-2 md:h-10" onClick={() => setTexto(DEFAULT_TEMPLATES[tipo])} disabled={!podeSalvar || texto === DEFAULT_TEMPLATES[tipo]}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Texto padrão
        </Button>
        <Button type="button" className="h-11 gap-2 md:h-10" onClick={() => onSalvar(texto.trim())} disabled={!podeSalvar || !mudou || invalido || salvando}>
          <Save className="h-4 w-4" aria-hidden="true" /> {salvando ? "Salvando…" : "Salvar texto"}
        </Button>
      </div>
      {!podeSalvar && <p className="text-xs text-warning">Editar o texto exige a migration {tipo === "retorno" ? "0020" : "0019"} no banco. Enquanto isso, vale o texto padrão.</p>}
    </div>
  )
}
