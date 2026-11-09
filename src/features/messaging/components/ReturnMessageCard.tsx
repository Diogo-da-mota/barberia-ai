import { useState } from "react"
import { HeartHandshake } from "lucide-react"
import { MESSAGE_VARIABLES, messageVariables } from "../../../../supabase/functions/_shared/messages"
import type { ReturnUnit } from "../api"
import { RETURN_LIMITS, returnPeriodLabel, useReturnSettings } from "../useReturnSettings"
import { MessageTemplateEditor } from "./MessageTemplateEditor"
import { Input } from "@/ui/input"
import { OptionSelect } from "@/ui/option-select"
import { Panel } from "@/ui/finance"
import { Toggle } from "@/ui/toggle"

const UNIDADES: { value: ReturnUnit; label: string }[] = [
  { value: "dias", label: "dias" },
  { value: "semanas", label: "semanas" },
  { value: "meses", label: "meses" },
]

/**
 * Retorno do cliente: quando o cliente fica N dias/semanas/meses sem voltar depois do último atendimento concluído,
 * o worker (disparado pelo n8n a cada minuto) envia esta mensagem. Só para quem aceitou receber novidades.
 */
export function ReturnMessageCard({ shop }: { shop: { id: string; nome: string; fuso: string } }) {
  const { settings, supported, saving, change, saveText } = useReturnSettings(shop.id)
  const [quantidade, setQuantidade] = useState(String(settings.quantidade))
  const [base, setBase] = useState(settings.quantidade)
  if (settings.quantidade !== base) {
    setBase(settings.quantidade)
    setQuantidade(String(settings.quantidade))
  }
  const periodo = returnPeriodLabel(settings.quantidade, settings.unidade)
  const confirmarQuantidade = () => {
    const n = Number(quantidade)
    if (Number.isFinite(n) && n !== settings.quantidade) change({ quantidade: n })
    else setQuantidade(String(settings.quantidade))
  }

  let exemplo: Record<string, string>
  try {
    const visita = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    exemplo = messageVariables({ cliente: "João Silva", servico: "Corte + Barba", profissional: "Carlos Barbosa", inicio: visita, fuso: shop.fuso, barbearia: shop.nome, endereco: "Rua das Flores, 123 - Centro", periodo })
  } catch {
    exemplo = { ...Object.fromEntries(MESSAGE_VARIABLES.map((v) => [v.chave, v.exemplo])), periodo }
  }

  return (
    <Panel className="rounded-card border border-border bg-card p-5">
      <section aria-label="Retorno do cliente">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <HeartHandshake className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-display text-base font-bold tracking-wide">Retorno do cliente</p>
              <p className="text-xs text-muted-foreground">
                Envia mensagem quando o cliente fica um tempo sem voltar. Só para quem aceitou receber novidades.
              </p>
            </div>
          </div>
          <Toggle
            pressed={settings.ativo}
            onPressedChange={(pressed) => change({ ativo: pressed })}
            disabled={!supported || saving}
            aria-label="Ativar retorno do cliente"
            className="h-10 w-10 shrink-0 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="retorno-quantidade">Enviar quando o cliente ficar</label>
          <Input
            id="retorno-quantidade"
            type="number"
            inputMode="numeric"
            min={1}
            max={RETURN_LIMITS[settings.unidade]}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            onBlur={confirmarQuantidade}
            onKeyDown={(e) => { if (e.key === "Enter") confirmarQuantidade() }}
            disabled={!supported || saving}
            className="h-10 w-20 text-center tabular-nums"
          />
          <OptionSelect
            value={settings.unidade}
            onValueChange={(v) => change({ unidade: v as ReturnUnit })}
            options={UNIDADES}
            disabled={!supported || saving}
            aria-label="Unidade do tempo sem voltar"
            className="h-10 w-32"
          />
          <span>sem voltar.</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Conta a partir do último atendimento concluído. Uma mensagem por ausência; não envia se o cliente já tiver horário marcado.
          {!settings.ativo && " Desligado: nenhuma mensagem de retorno sai."}
        </p>

        <MessageTemplateEditor
          tipo="retorno"
          titulo={`Retorno (${periodo} sem voltar)`}
          icon={<HeartHandshake className="h-4 w-4 text-primary" />}
          salvo={settings.texto}
          exemplo={exemplo}
          podeSalvar={supported}
          salvando={saving}
          onSalvar={saveText}
        />
      </section>
    </Panel>
  )
}
