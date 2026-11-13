import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { type ReactNode, createContext, useContext, useEffect } from "react"
import type { Session, User } from "@supabase/supabase-js"
import { onAuthStateChange, signOut } from "@/features/auth/services/auth"
import { currentArea, subscribeArea } from "@/lib/supabase"
import { AUTH_AREAS, type AuthArea } from "@/lib/shopPaths"
import { AppearanceProvider } from "@/lib/appearance"
import { ThemeProvider } from "@/lib/theme"
import { Toaster } from "@/ui/sonner"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
})

/** Cada login (painel e cliente, separadamente) fica salvo no aparelho por 30 dias desde a entrada; renovar o token não conta. */
const SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Quando ESTA sessão entrou: o `amr` do token guarda o horário do login e não muda na renovação. Assim o prazo de uma área
 * não é estendido por um login na outra (o `last_sign_in_at` é da conta, não da sessão). Sem token legível, usa a conta.
 */
function sessionStartedAt(session: Session | null, user: User | null): number {
  try {
    const payload = session!.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
    const amr = (JSON.parse(atob(payload)) as { amr?: { timestamp?: number }[] }).amr ?? []
    const latest = Math.max(...amr.map((entry) => entry.timestamp ?? NaN)) * 1000
    if (Number.isFinite(latest)) return latest
  } catch {
    // sem sessão ou token ilegível
  }
  return user?.last_sign_in_at ? Date.parse(user.last_sign_in_at) : NaN
}

const AppContext = createContext<{
  queryClient: QueryClient
} | null>(null)

export function AppProviders({ children }: { children: ReactNode }) {
  // A conta da tela mudou (saiu, entrou outra pessoa no tablet do balcão ou a aba passou do painel para a barbearia com
  // outra conta): descarta tudo o que foi buscado antes, para ninguém ver dados de outra conta. Renovar o token não limpa.
  // Eventos da outra área (login do cliente em outra aba) só limpam quando esta aba passar a mostrar aquela área.
  useEffect(() => {
    const users: Partial<Record<AuthArea, string | null>> = {}
    let shown: string | null | undefined
    const check = () => {
      const user = users[currentArea()]
      if (user === undefined) return
      if (shown !== undefined && user !== shown) void queryClient.resetQueries()
      shown = user
    }
    const subscriptions = AUTH_AREAS.map((area) =>
      onAuthStateChange(({ session, user }) => {
        if (user && Date.now() - sessionStartedAt(session, user) > SESSION_MAX_MS) {
          void signOut("local", area).catch(() => undefined) // o evento de saída que vem em seguida limpa os dados
          return
        }
        users[area] = user?.id ?? null
        check()
      }, area)
    )
    const stopArea = subscribeArea(check)
    return () => {
      subscriptions.forEach(({ subscription }) => subscription.unsubscribe())
      stopArea()
    }
  }, [])

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AppContext.Provider value={{ queryClient }}>
          <AppearanceProvider>
            {children}
            <Toaster position="bottom-right" richColors />
          </AppearanceProvider>
        </AppContext.Provider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp deve ser usado dentro de AppProviders")
  return ctx
}
