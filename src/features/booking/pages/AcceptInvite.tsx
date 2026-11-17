import { useState } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PublicHeader } from "@/app/PublicHeader"
import { AuthDialog } from "@/features/auth/components/AuthDialog"
import type { AuthView } from "@/features/auth/domain"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { signOut } from "@/features/auth/services/auth"
import { Button } from "@/ui/button"
import { EmptyState, Panel } from "@/ui/finance"
import { toast } from "@/ui/sonner"
import { acceptInvite } from "../api"
import { bookingErrorMessage } from "../domain"

export function AcceptInvite() {
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session, loading } = useAuth()
  const [authView, setAuthView] = useState<AuthView | null>(null)
  const [error, setError] = useState<string | null>(null)
  // o servidor recusou porque a conta logada não é a do e-mail do convite: troca de conta em vez de tentar de novo
  const [wrongAccount, setWrongAccount] = useState(false)

  const accept = useMutation({
    mutationFn: () => acceptInvite(token),
    onSuccess: async () => {
      // a Equipe passa a mostrar o novo profissional (barbeiro) ou membro (gerente)
      for (const key of ["my-barbershops", "professionals", "barbers", "team-links", "members", "plan-usage"]) await queryClient.invalidateQueries({ queryKey: [key] })
      toast.success("Convite aceito.")
      navigate("/dashboard", { replace: true })
    },
    onError: (e) => {
      setWrongAccount((e as { message?: string } | null)?.message === "invite_wrong_email")
      setError(bookingErrorMessage(e))
    },
  })

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <PublicHeader onLogin={() => setAuthView("entrar")} />
      <main className="mx-auto flex w-[min(100%-2rem,480px)] flex-col gap-6 py-10">
        {!token ? (
          <EmptyState title="Link de convite incompleto" description="Peça um novo link ao proprietário ou ao gerente da barbearia." action={<Button asChild className="h-11"><Link to="/">Voltar ao início</Link></Button>} />
        ) : (
          <Panel className="flex flex-col gap-4 p-5">
            <h1 className="font-display text-2xl font-bold tracking-wide">Convite para a equipe</h1>
            <p className="text-sm text-muted-foreground">
              {session ? "Aceite para entrar na equipe da barbearia. O convite vale para o email que o recebeu." : "Entre ou crie uma conta com o email que recebeu o convite."}
            </p>
            {error && <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            {session && wrongAccount ? (
              <Button className="h-11 md:h-10" onClick={async () => { await signOut().catch(() => undefined); setError(null); setWrongAccount(false); setAuthView("entrar") }}>
                Entrar com outra conta
              </Button>
            ) : session ? (
              <Button className="h-11 md:h-10" disabled={accept.isPending || loading} onClick={() => { setError(null); accept.mutate() }}>
                {accept.isPending ? "Aceitando…" : "Aceitar convite"}
              </Button>
            ) : (
              <Button className="h-11 md:h-10" disabled={loading} onClick={() => setAuthView("entrar")}>Entrar para aceitar</Button>
            )}
          </Panel>
        )}
      </main>
      <AuthDialog open={Boolean(authView) && !loading && !session} view={authView} next={location.pathname + location.search} notice={null} onViewChange={setAuthView} onClose={() => setAuthView(null)} />
    </div>
  )
}
