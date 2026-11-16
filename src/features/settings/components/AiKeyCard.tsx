import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { OptionSelect } from "@/ui/option-select"
import { FIELD, SettingsCard } from "@/ui/settings-card"
import { toast } from "@/ui/sonner"
import { fetchAiConnection, removeAiKey, saveAiKey, type AiConnection, type AiProvider } from "../ai-api"

const PROVIDERS: { value: AiProvider; label: string; keysUrl: string }[] = [
  { value: "openai", label: "OpenAI", keysUrl: "https://platform.openai.com/api-keys" },
  { value: "anthropic", label: "Anthropic", keysUrl: "https://console.anthropic.com/settings/keys" },
]

const ERRORS: Record<string, string> = {
  key_rejected: "O provedor recusou esta chave. Confira se copiou a chave inteira e se ela está ativa.",
  invalid_key: "Cole a chave inteira, sem espaços.",
  provider_unavailable: "O provedor não respondeu agora. Tente de novo em instantes.",
  not_configured: "A conexão de IA ainda não foi ativada no servidor.",
  forbidden: "Só o proprietário e o gerente conectam a IA.",
}
const errorText = (e: unknown, fallback: string) => ERRORS[(e as Error | null)?.message ?? ""] ?? fallback

/** Configurações › Assistente: a chave de API da barbearia (OpenAI ou Anthropic). A chave vai uma vez ao servidor, que confere, cifra e guarda; a tela só vê o final. */
export function AiKeyCard({ shopId }: { shopId: string }) {
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: ["ai-connection", shopId], queryFn: () => fetchAiConnection(shopId), retry: false })
  const [editing, setEditing] = useState(false)
  const [provider, setProvider] = useState<AiProvider>("openai")
  const [key, setKey] = useState("")
  const done = (conexao: AiConnection) => {
    queryClient.setQueryData(["ai-connection", shopId], conexao)
    setEditing(false)
    setKey("")
  }
  const save = useMutation({ mutationFn: () => saveAiKey(shopId, provider, key), onSuccess: (c) => { done(c); toast.success("IA conectada.") } })
  const remove = useMutation({ mutationFn: () => removeAiKey(shopId), onSuccess: () => { done(null); toast.success("IA desconectada.") } })
  const conn = status.data
  const label = (p: AiProvider) => PROVIDERS.find((o) => o.value === p)!.label

  return (
    <SettingsCard icon={KeyRound} title="Conexão de IA" hint="A chave de API que a assistente usa. O uso é cobrado pelo provedor, na conta da barbearia.">
      {status.isPending ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Verificando conexão…</p>
      ) : status.isError ? (
        <p role="alert" className="text-sm text-danger">{errorText(status.error, "Não foi possível verificar a conexão de IA agora.")}</p>
      ) : conn && !editing ? (
        <>
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-income" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium">{label(conn.provedor)} conectada</p>
              <p className="text-sm text-muted-foreground tabular-nums">Chave terminada em ••••{conn.final} · desde {new Date(conn.atualizado_em).toLocaleDateString("pt-BR")}</p>
            </div>
          </div>
          {remove.isError && <p role="alert" className="text-sm text-danger">{errorText(remove.error, "Não foi possível desconectar. Tente novamente.")}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11 md:h-10" onClick={() => { setProvider(conn.provedor); save.reset(); setEditing(true) }}>Trocar chave</Button>
            <Button variant="outline" className="h-11 md:h-10" disabled={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? "Desconectando…" : "Desconectar"}</Button>
          </div>
        </>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <div className="grid gap-1.5">
            <Label htmlFor="ai-provedor">Provedor</Label>
            <OptionSelect id="ai-provedor" value={provider} onValueChange={(v) => setProvider(v as AiProvider)} options={PROVIDERS} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ai-chave">Chave da API</Label>
            <Input id="ai-chave" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" className={FIELD} />
            <p className="text-xs text-muted-foreground">
              Crie a chave no painel da{" "}
              <a href={PROVIDERS.find((o) => o.value === provider)!.keysUrl} target="_blank" rel="noreferrer" className="underline">{label(provider)}</a>.
              Ela fica cifrada no servidor e não aparece de novo.
            </p>
          </div>
          {save.isError && <p role="alert" className="text-sm text-danger">{errorText(save.error, "Não foi possível salvar. Tente novamente.")}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="h-11 md:h-10" disabled={save.isPending || key.trim().length < 20}>{save.isPending ? "Conferindo a chave…" : "Conectar"}</Button>
            {conn && <Button type="button" variant="outline" className="h-11 md:h-10" onClick={() => setEditing(false)}>Cancelar</Button>}
          </div>
        </form>
      )}
    </SettingsCard>
  )
}
