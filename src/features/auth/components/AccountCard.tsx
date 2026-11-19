import { useCallback, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { leavableShops, ownedShops } from "@/features/auth/account"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { fetchLeaveSummary } from "@/features/auth/services/account"
import { fetchMyBarbershops } from "@/features/home/api"
import { Button } from "@/ui/button"
import { Panel } from "@/ui/finance"
import { toast } from "@/ui/sonner"
import { useDeleteAccountReturn } from "../hooks/useDeleteAccountReturn"
import { DeleteAccountDialog } from "./DeleteAccountDialog"
import { LeaveShopDialog } from "./LeaveShopDialog"

/**
 * Conta (versão curta de Mais: equipe sem gestão e conta sem barbearia): sair de uma barbearia e excluir a conta.
 * A lista de barbearias só decide o que aparece; o servidor confere tudo de novo com a pessoa do token.
 */
export function AccountCard() {
  const { session } = useAuth()
  const userId = session?.user.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const shops = useQuery({ queryKey: ["my-barbershops", userId], queryFn: () => fetchMyBarbershops(userId!), enabled: Boolean(userId) })
  const list = shops.data?.status === "ok" ? shops.data.barbershops : []
  const leavable = leavableShops(list)
  const owned = ownedShops(list)
  // Só oferece a saída quando o banco já tem a função (migration 0057); a resposta é o resumo da 1ª barbearia, reaproveitado no pop-up.
  const leaveReady = useQuery({ queryKey: ["leave-summary", leavable[0]?.id], queryFn: () => fetchLeaveSummary(leavable[0]!.id), enabled: leavable.length > 0, retry: false })
  const [leaving, setLeaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  useDeleteAccountReturn(userId, useCallback(() => setDeleting(true), []))

  if (!session) return null

  return (
    <Panel className="flex flex-col gap-4 p-4 sm:p-5">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-wide">Conta</h2>
        <p className="text-sm text-muted-foreground">Encerrar seu vínculo com uma barbearia ou excluir seus dados pessoais.</p>
      </div>

      {leavable.length > 0 && leaveReady.isSuccess && (
        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">Sair da barbearia</p>
            <p className="text-sm text-muted-foreground">Você deixa a equipe e perde o acesso aos dados dela. Sua conta continua.</p>
          </div>
          <Button variant="outline" className="h-11 shrink-0 md:h-10" onClick={() => setLeaving(true)}>Sair da barbearia</Button>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Excluir minha conta</p>
          <p className="text-sm text-muted-foreground">
            {owned.length > 0
              ? `Você é proprietário de ${owned.map((s) => s.nome).join(", ")}: a exclusão precisa de atendimento e fica registrada como pedido.`
              : "Apaga seu login e seus dados pessoais em todas as barbearias. Não dá para desfazer."}
          </p>
        </div>
        <Button variant="outline" className="h-11 shrink-0 text-destructive hover:text-destructive md:h-10" onClick={() => setDeleting(true)}>Excluir minha conta</Button>
      </div>

      <LeaveShopDialog
        open={leaving}
        shops={leavable}
        onClose={() => setLeaving(false)}
        onLeft={(shop, result) => {
          setLeaving(false)
          toast.success(result.status === "saiu" ? `Você saiu da ${shop.nome}.` : `Você já não fazia parte da ${shop.nome}.`)
          navigate("/dashboard", { replace: true })
          void queryClient.resetQueries() // nada do que foi lido daquela barbearia fica na tela
        }}
      />
      <DeleteAccountDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onDeleted={() => {
          setDeleting(false)
          navigate("/", { replace: true })
          toast.success("Sua conta foi excluída.")
        }}
      />
    </Panel>
  )
}
