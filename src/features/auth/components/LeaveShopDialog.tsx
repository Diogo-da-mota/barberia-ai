import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { leaveErrorMessage, type LeaveResult } from "@/features/auth/account"
import { fetchLeaveSummary, leaveBarbershop } from "@/features/auth/services/account"
import { isMissingSchema } from "@/features/booking/domain"
import type { MyBarbershop } from "@/features/home/domain"
import { formatPrice } from "@/features/catalog/domain"
import { Button } from "@/ui/button"
import { OptionSelect } from "@/ui/option-select"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog"

/**
 * Sair de UMA barbearia (equipe sem ser dona). Mostra antes o que muda (reservas futuras, comissões a receber, Google
 * Agenda) com os dados do próprio card, lidos no servidor. Quem decide e protege é leave_barbershop (0057).
 */
export function LeaveShopDialog({ open, shops, onClose, onLeft }: {
  open: boolean
  shops: MyBarbershop[]
  onClose: () => void
  onLeft: (shop: MyBarbershop, result: LeaveResult) => void
}) {
  const [chosen, setChosen] = useState<string>("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shop = shops.find((s) => s.id === chosen) ?? shops[0] ?? null
  const summary = useQuery({
    queryKey: ["leave-summary", shop?.id],
    queryFn: () => fetchLeaveSummary(shop!.id),
    enabled: open && Boolean(shop),
    staleTime: 0,
  })
  const s = summary.data
  const missing = summary.isError && isMissingSchema(summary.error)

  const close = () => { setError(null); setPending(false); onClose() }
  const confirm = async () => {
    if (!shop) return
    setPending(true)
    setError(null)
    try {
      const result = await leaveBarbershop(shop.id)
      setPending(false)
      onLeft(shop, result)
    } catch (e) {
      setPending(false)
      setError(leaveErrorMessage(e))
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && close()}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[520px] overflow-y-auto bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle>Sair da barbearia?</AlertDialogTitle>
          <AlertDialogDescription>
            Você perde na hora o acesso à agenda, aos clientes, às comissões e aos dados desta barbearia. Sua conta continua.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {shops.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <p id="sair-barbearia" className="text-sm font-medium">De qual barbearia você quer sair?</p>
            <OptionSelect aria-label="Barbearia" value={shop?.id ?? ""} onValueChange={(v) => { setChosen(v); setError(null) }}
              options={shops.map((x) => ({ value: x.id, label: x.nome }))} />
          </div>
        )}

        {shop && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Seu cadastro de profissional na <span className="font-medium text-foreground">{shop.nome}</span> fica inativo: ninguém marca horário novo com você lá.</li>
            {s && (s.reservas_futuras ?? 0) > 0 && (
              <li><span className="font-medium text-foreground">{s.reservas_futuras === 1 ? "1 reserva futura" : `${s.reservas_futuras} reservas futuras`}</span> com você {s.reservas_futuras === 1 ? "fica" : "ficam"} com a barbearia para reagendar com outro profissional ou cancelar. Avise a barbearia.</li>
            )}
            {s && (s.comissoes_a_receber_centavos ?? 0) > 0 && (
              <li>Comissões ainda não repassadas: <span className="font-medium text-foreground">{formatPrice(s.comissoes_a_receber_centavos ?? 0)}</span>. Combine o acerto antes de sair: depois você não verá mais esses valores aqui.</li>
            )}
            {s?.google_agenda && <li>O Google Agenda ligado a esta barbearia será desconectado.</li>}
            <li>O histórico de atendimentos, pagamentos e comissões fica com a barbearia.</li>
            <li>Suas reservas como cliente e as outras barbearias não mudam. Para voltar, a barbearia precisa enviar um novo convite.</li>
          </ul>
        )}

        {summary.isLoading && <p role="status" className="text-sm text-muted-foreground">Conferindo suas reservas e comissões…</p>}
        {missing && <p role="alert" className="text-sm font-medium text-destructive">Esta função ainda está sendo preparada no banco de dados. Tente mais tarde.</p>}
        {summary.isError && !missing && <p role="alert" className="text-sm font-medium text-destructive">Não foi possível conferir suas reservas agora. Tente novamente.</p>}
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="h-11 md:h-10" onClick={close}>Ficar na barbearia</Button>
          <Button variant="destructive" className="h-11 md:h-10" disabled={pending || !s?.pode_sair} onClick={() => void confirm()}>Sair da barbearia</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
