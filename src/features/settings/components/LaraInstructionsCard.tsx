import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, NotebookPen } from "lucide-react"
import { Button } from "@/ui/button"
import { PendingNotice, SettingsCard } from "@/ui/settings-card"
import { toast } from "@/ui/sonner"
import { fetchLaraInstructions, saveLaraInstructions } from "../ai-api"

const LIMIT = 2000
const ERRORS: Record<string, string> = {
  forbidden: "Só o proprietário e o gerente mudam as instruções.",
  invalid_instructions: `Use até ${LIMIT} caracteres.`,
}

/** Instruções da Lara por barbearia (migration 0025): o servidor junta às regras fixas em todas as conversas desta barbearia. */
export function LaraInstructionsCard({ shopId }: { shopId: string }) {
  const queryClient = useQueryClient()
  const saved = useQuery({ queryKey: ["lara-instructions", shopId], queryFn: () => fetchLaraInstructions(shopId) })
  const [draft, setDraft] = useState<string | null>(null) // null = sem edição
  const value = draft ?? saved.data ?? ""
  const save = useMutation({
    mutationFn: () => saveLaraInstructions(shopId, value),
    onSuccess: () => {
      queryClient.setQueryData(["lara-instructions", shopId], value.trim())
      setDraft(null)
      toast.success("Instruções salvas. A Lara usa a partir da próxima pergunta.")
    },
  })

  return (
    <SettingsCard icon={NotebookPen} title="Instruções da Lara" hint="Como a Lara deve responder nesta barbearia. Vale para todas as conversas da gestão.">
      {saved.isPending ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Carregando…</p>
      ) : saved.isError ? (
        <p role="alert" className="text-sm text-danger">Não foi possível carregar as instruções agora.</p>
      ) : saved.data === null ? (
        <PendingNotice>As instruções dependem de uma atualização do banco (migration 0025) ainda não aplicada.</PendingNotice>
      ) : (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <label htmlFor="lara-instrucoes" className="text-sm font-medium">Instruções personalizadas</label>
          <textarea
            id="lara-instrucoes"
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            maxLength={LIMIT}
            aria-describedby="lara-instrucoes-ajuda"
            placeholder="Ex.: Chame os clientes pelo primeiro nome. Ao listar a agenda, mostre o total do dia no fim."
            className="min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
            <p id="lara-instrucoes-ajuda">A Lara segue estas instruções sem sair das regras fixas: só consulta e só os dados desta barbearia.</p>
            <span className="tabular-nums">{value.length}/{LIMIT}</span>
          </div>
          {save.isError && <p role="alert" className="text-sm text-danger">{ERRORS[(save.error as Error | null)?.message ?? ""] ?? "Não foi possível salvar. Tente novamente."}</p>}
          <Button type="submit" className="h-11 self-start md:h-10" disabled={save.isPending || draft === null}>{save.isPending ? "Salvando…" : "Salvar instruções"}</Button>
        </form>
      )}
    </SettingsCard>
  )
}
