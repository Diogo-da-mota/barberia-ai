import { useState, type FormEvent } from "react"
import { useQuery } from "@tanstack/react-query"
import { useLocation } from "react-router-dom"
import { canRequestDeletion, DELETION_EFFECTS, loginMethods, needsReauth } from "@/features/auth/account"
import { authErrorMessage, deleteAccountErrorMessage } from "@/features/auth/domain"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { REAUTH_KEY, RETURN_PARAM } from "@/features/auth/hooks/useDeleteAccountReturn"
import { fetchMyDeletionRequest, requestAccountDeletion } from "@/features/auth/services/account"
import { deleteMyAccount, signInWithGoogle, signInWithPassword, signOut } from "@/features/auth/services/auth"
import { AUTH_AREAS } from "@/lib/shopPaths"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog"

type Step = "confirmar" | "reautenticar" | "pedido"

/**
 * Exclusão da própria conta (LGPD). O servidor exige login recente (15 min) e recusa dono de barbearia e reserva futura
 * como cliente; nesses casos a pessoa registra um pedido de exclusão para atendimento. Depois de excluir, encerra as
 * sessões das duas áreas neste navegador e chama `onDeleted` (quem abriu decide para onde ir).
 */
export function DeleteAccountDialog({ open, onClose, onDeleted }: { open: boolean; onClose: () => void; onDeleted: () => void }) {
  const { session } = useAuth()
  const location = useLocation()
  const user = session?.user
  const methods = loginMethods(user)
  const [step, setStep] = useState<Step>("confirmar")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canRequest, setCanRequest] = useState(false)
  const [requestedAt, setRequestedAt] = useState<string | null>(null)
  const [password, setPassword] = useState("")
  // Banco sem a 0057 (sem a tabela de pedidos) ou pedido já registrado: não oferece um botão que não serve.
  const requests = useQuery({ queryKey: ["deletion-request", user?.id], queryFn: fetchMyDeletionRequest, enabled: open && Boolean(user), staleTime: 0 })
  const pendingSince = requests.data?.pending ? new Date(requests.data.pending.criado_em).toLocaleDateString("pt-BR") : null
  const offerRequest = canRequest && requests.data?.supported === true && !pendingSince

  const close = () => {
    setStep("confirmar"); setError(null); setCanRequest(false); setRequestedAt(null); setPassword(""); setPending(false)
    onClose()
  }

  const attempt = async () => {
    setPending(true)
    setError(null)
    try {
      await deleteMyAccount()
    } catch (e) {
      setPending(false)
      if (needsReauth(e)) {
        setStep("reautenticar")
        return
      }
      setStep("confirmar")
      setCanRequest(canRequestDeletion(e))
      setError(deleteAccountErrorMessage(e))
      return
    }
    // A conta já não existe: as sessões locais das duas áreas são descartadas mesmo que o servidor responda erro.
    await Promise.all(AUTH_AREAS.map((area) => signOut("local", area).catch(() => undefined)))
    setPending(false)
    onDeleted()
  }

  const confirmPassword = async (event: FormEvent) => {
    event.preventDefault()
    if (!user?.email || !password) return
    setPending(true)
    setError(null)
    try {
      await signInWithPassword(user.email, password)
    } catch (e) {
      setPending(false)
      setError(authErrorMessage(e))
      return
    }
    setPassword("")
    await attempt()
  }

  const confirmGoogle = async () => {
    if (!user) return
    setPending(true)
    try {
      sessionStorage.setItem(REAUTH_KEY, user.id)
    } catch {
      // sem armazenamento: ao voltar, a pessoa abre o pop-up de novo
    }
    const params = new URLSearchParams(location.search)
    params.set(RETURN_PARAM, "excluir")
    try {
      await signInWithGoogle(`${location.pathname}?${params}`, { selectAccount: true })
    } catch (e) {
      setPending(false)
      setError(authErrorMessage(e))
    }
  }

  const request = async () => {
    setPending(true)
    setError(null)
    try {
      const pedido = await requestAccountDeletion()
      setRequestedAt(new Date(pedido.criado_em).toLocaleDateString("pt-BR"))
      setStep("pedido")
    } catch {
      setError("Não foi possível registrar o pedido. Tente novamente.")
    }
    setPending(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && close()}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[520px] overflow-y-auto bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle>{step === "pedido" ? "Pedido de exclusão registrado" : "Excluir sua conta?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {step === "pedido"
              ? `Recebemos seu pedido em ${requestedAt}. A equipe do Barberia vai analisar e responder pelo e-mail da conta. Até lá, sua conta continua ativa.`
              : "Seu login e seus dados de acesso serão apagados. As reservas antigas ficam na barbearia sem seu nome, WhatsApp e e-mail. Não dá para desfazer."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {step !== "pedido" && (
          <div className="flex flex-col gap-3 text-sm">
            {user?.email && <p className="text-muted-foreground">Conta: <span className="font-medium text-foreground">{user.email}</span></p>}
            <Effects title="Será apagado" items={DELETION_EFFECTS.apagado} />
            <Effects title="Fica sem seus dados" items={DELETION_EFFECTS.anonimizado} />
            <Effects title="Fica guardado" items={DELETION_EFFECTS.conservado} />
          </div>
        )}

        {step === "reautenticar" && (
          <div className="flex flex-col gap-3 rounded-card border border-border p-3">
            <p className="text-sm font-medium">Por segurança, confirme que é você.</p>
            {methods.password && (
              <form className="flex flex-col gap-2" onSubmit={(e) => void confirmPassword(e)}>
                <Label htmlFor="excluir-senha">Sua senha</Label>
                <Input id="excluir-senha" type="password" autoComplete="current-password" className="h-11" value={password} onChange={(e) => setPassword(e.target.value)} />
                <Button type="submit" variant="destructive" className="h-11 md:h-10" disabled={pending || !password}>Confirmar e excluir</Button>
              </form>
            )}
            {methods.google && (
              <Button variant="outline" className="h-11 md:h-10" disabled={pending} onClick={() => void confirmGoogle()}>Confirmar com o Google</Button>
            )}
            {!methods.password && !methods.google && <p className="text-sm text-muted-foreground">Saia e entre de novo na sua conta e tente outra vez.</p>}
          </div>
        )}

        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
        {canRequest && pendingSince && <p className="text-sm text-muted-foreground">Seu pedido de exclusão de {pendingSince} está em análise. A resposta vai para o e-mail da conta.</p>}

        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          {step === "pedido" ? (
            <Button className="h-11 md:h-10" onClick={close}>Entendi</Button>
          ) : (
            <>
              <Button variant="outline" className="h-11 md:h-10" onClick={close}>Manter minha conta</Button>
              {offerRequest && <Button variant="outline" className="h-11 md:h-10" disabled={pending} onClick={() => void request()}>Registrar pedido de exclusão</Button>}
              {step === "confirmar" && <Button variant="destructive" className="h-11 md:h-10" disabled={pending} onClick={() => void attempt()}>Excluir conta</Button>}
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Effects({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-semibold">{title}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  )
}
