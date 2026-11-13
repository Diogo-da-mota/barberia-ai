import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { getSession, onAuthStateChange, signOut } from "@/features/auth/services/auth"
import { currentArea, subscribeArea } from "@/lib/supabase"
import type { AuthArea } from "@/lib/shopPaths"
import { type Session } from "@supabase/supabase-js"

/** Área aberta nesta aba (painel ou cliente), acompanhando a navegação. */
export const useAuthArea = (): AuthArea => useSyncExternalStore(subscribeArea, currentArea)

/**
 * Sessão da área aberta: no painel, a conta do painel; nas páginas da barbearia, a conta do cliente. `area` força uma
 * delas (só o /auth/callback precisa). `logout` encerra apenas a sessão desta área, mesmo se a tela já tiver navegado.
 */
export function useAuth(area?: AuthArea) {
  const routeArea = useAuthArea()
  const active = area ?? routeArea
  const [state, setState] = useState<{ area: AuthArea; session: Session | null } | null>(null)

  useEffect(() => {
    let mounted = true
    getSession(active)
      .then((session) => { if (mounted) setState({ area: active, session }) })
      // Não travar em loading infinito se a sessão não puder ser lida
      .catch(() => { if (mounted) setState({ area: active, session: null }) })

    const subscription = onAuthStateChange(({ session }) => setState({ area: active, session }), active)

    return () => {
      mounted = false
      subscription.subscription.unsubscribe()
    }
  }, [active])

  const logout = useCallback(() => signOut("local", active), [active])
  const current = state?.area === active ? state : null

  return { session: current?.session ?? null, loading: !current, logout, area: active }
}
