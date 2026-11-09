import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { type ReactNode, createContext, useContext } from "react"
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

const AppContext = createContext<{
  queryClient: QueryClient
} | null>(null)

export function AppProviders({ children }: { children: ReactNode }) {
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
