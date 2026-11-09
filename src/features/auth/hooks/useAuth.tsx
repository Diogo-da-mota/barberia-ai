import { useCallback, useEffect, useState, type ReactNode } from "react"
import { getSession, onAuthStateChange, signOut } from "@/features/auth/services/auth"
import { type Session } from "@supabase/supabase-js"

type AuthState = {
  session: Session | null
  loading: boolean
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ session: null, loading: true })

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const session = await getSession()
        if (mounted) setState((s) => ({ ...s, session, loading: false }))
      } catch {
        // Não travar em loading infinito se a sessão não puder ser lida
        if (mounted) setState((s) => ({ ...s, session: null, loading: false }))
      }
    })()

    const subscription = onAuthStateChange(({ session }) => {
      setState((s) => ({ ...s, session, loading: false }))
    })

    return () => {
      mounted = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  const logout = useCallback(async () => {
    await signOut()
  }, [])

  return { ...state, logout }
}

export function AuthRequired({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) {
    return null
  }
  if (!session) {
    return null
  }
  return <>{children}</>
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) {
    return null
  }
  if (session) {
    return null
  }
  return <>{children}</>
}
