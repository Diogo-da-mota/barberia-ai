import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { Panel } from "@/ui/finance"
import { toast } from "@/ui/sonner"
import { NewPasswordForm } from "../components/AuthForms"
import { consumeNext, parseAuthCallback } from "../domain"
import { onAuthStateChange } from "../services/auth"

export function AuthCallback() {
  const navigate = useNavigate()
  const { session, loading } = useAuth()
  // Lido na primeira renderização: o cliente Supabase limpa o endereço ao processar o retorno.
  const [callback] = useState(() => parseAuthCallback(window.location.hash, window.location.search))
  const [isRecovery, setIsRecovery] = useState(callback.isRecovery)

  useEffect(() => {
    const { subscription } = onAuthStateChange(({ event }) => {
      if (event === "PASSWORD_RECOVERY") setIsRecovery(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  const showNewPassword = !callback.error && !loading && isRecovery && Boolean(session)

  useEffect(() => {
    if (callback.error) {
      navigate(`/?auth=entrar&erro=${callback.error}`, { replace: true })
      return
    }
    if (loading || showNewPassword) return

    if (session) {
      navigate(consumeNext(), { replace: true })
    } else {
      navigate(callback.hasAuthParams ? "/?auth=entrar&erro=falha" : "/?auth=entrar", { replace: true })
    }
  }, [callback, loading, session, showNewPassword, navigate])

  if (showNewPassword) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
        <Panel className="flex w-full max-w-[480px] flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display text-2xl font-bold tracking-wide">Definir nova senha</h1>
            <p className="text-sm text-muted-foreground">Escolha a senha que você vai usar para entrar.</p>
          </div>
          <NewPasswordForm
            onDone={() => {
              toast.success("Senha alterada.")
              navigate("/dashboard", { replace: true })
            }}
          />
        </Panel>
      </main>
    )
  }

  return (
    <main role="status" className="flex min-h-dvh items-center justify-center bg-background p-6">
      <span className="text-sm text-muted-foreground">Processando login…</span>
    </main>
  )
}
