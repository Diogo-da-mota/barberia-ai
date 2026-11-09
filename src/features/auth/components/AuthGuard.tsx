import { useEffect, useRef, useState } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { getCurrentUser, signOut } from "@/features/auth/services/auth"
import { Skeleton } from "@/ui/skeleton"

/** Só 401/403 ou sessão ausente invalidam a sessão. Falha de rede não expulsa o usuário. */
function isSessionRejected(error: unknown): boolean {
  const { status, name } = error as { status?: number; name?: string }
  return status === 401 || status === 403 || name === "AuthSessionMissingError"
}

/**
 * Guarda de rota: não renderiza os filhos antes de o servidor confirmar a sessão, pois
 * `getSession` apenas lê o navegador. Os dados continuam protegidos pelo RLS: o frontend
 * nunca é fronteira de segurança (Segurança.md).
 */
export function AuthGuard({ children, loginPath }: { children: React.ReactNode; loginPath?: () => string }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  const userId = session?.user.id
  const [check, setCheck] = useState<{ userId: string; accepted: boolean } | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false

    void (async () => {
      let accepted = true
      try {
        await getCurrentUser()
      } catch (error) {
        accepted = !isSessionRejected(error)
      }
      if (!cancelled) setCheck({ userId, accepted })
      if (!accepted) await signOut("local").catch(() => undefined)
    })()

    return () => {
      cancelled = true
    }
  }, [userId])

  const currentCheck = check?.userId === userId ? check : null

  // O cliente Supabase pode apagar a sessão recusada antes de esta validação terminar. O botão
  // Sair não chega aqui, pois ele navega para fora da área protegida antes de encerrar a sessão.
  const hadSession = useRef(false)
  if (session) hadSession.current = true

  if (!loading && (!session || currentCheck?.accepted === false)) {
    return (
      <Navigate
        to={loginPath ? loginPath() : "/?auth=entrar"}
        replace
        state={{
          from: location.pathname + location.search,
          ...(hadSession.current ? { sessionRejected: true } : {}),
        }}
      />
    )
  }

  if (loading || !currentCheck) {
    return (
      <div
        role="status"
        aria-label="Verificando sua sessão"
        className="flex min-h-dvh items-center justify-center bg-background p-6"
      >
        <Skeleton className="h-8 w-24" />
      </div>
    )
  }

  return <>{children}</>
}
