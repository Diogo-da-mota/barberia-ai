import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { saveAccentPreference } from "@/features/auth/services/auth"
import { toast } from "@/ui/sonner"
import { effectiveAccent, isAccent, isAccentChoice, readStoredAccent, writeStoredAccent, type AccentChoice, type AccentKey } from "./accent"

type Appearance = {
  /** Escolha do usuário (null = ainda não escolheu). */
  choice: AccentChoice | null
  /** Cor que está valendo na tela agora. */
  accent: AccentKey | null
  /** Troca a cor NA HORA em todo o site e guarda na conta do usuário. */
  setAccent: (choice: AccentChoice) => void
  /** Cor da barbearia aberta: vale só enquanto o usuário não tiver escolhido a dele. */
  setShopAccent: (accent: AccentKey | null) => void
}

const Ctx = createContext<Appearance>({ choice: null, accent: null, setAccent: () => {}, setShopAccent: () => {} })

/**
 * Cor de destaque do site INTEIRO (público, painel e pop-ups), por usuário: aplica `data-accent` no <html>, então
 * tudo que usa as variáveis do tema muda junto, inclusive o que abre fora da página. Clicar muda na hora; a escolha
 * é guardada na conta (qualquer aparelho). Sem conta (visitante) não há escolha: vale a cor da barbearia, se houver.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const userId = session?.user.id ?? null
  const saved = session?.user.user_metadata?.accent
  const [choice, setChoice] = useState<AccentChoice | null>(readStoredAccent)
  const [shop, setShop] = useState<AccentKey | null>(null)
  const hadUser = useRef(false)

  // a conta é a verdade: ao entrar, vale a cor guardada nela; ao sair, a cor some deste navegador
  useEffect(() => {
    if (loading) return
    if (userId) {
      hadUser.current = true
      if (isAccentChoice(saved)) { setChoice(saved); writeStoredAccent(saved) }
    } else {
      setChoice(null)
      writeStoredAccent(null)
      hadUser.current = false
    }
  }, [loading, userId, saved])

  const accent = effectiveAccent(choice, shop)
  useEffect(() => {
    const root = document.documentElement
    if (accent) root.dataset.accent = accent
    else delete root.dataset.accent
  }, [accent])

  const setAccent = useCallback((next: AccentChoice) => {
    setChoice(next)
    writeStoredAccent(next)
    if (userId) {
      saveAccentPreference(next).catch(() => toast.error("A cor mudou, mas não foi possível guardá-la na sua conta agora. Ela vale neste aparelho."))
    }
  }, [userId])

  const setShopAccent = useCallback((next: AccentKey | null) => setShop(next), [])
  const value = useMemo(() => ({ choice, accent, setAccent, setShopAccent }), [choice, accent, setAccent, setShopAccent])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppearance() {
  return useContext(Ctx)
}

/** Página pública: aplica a cor da barbearia enquanto a pessoa não tiver a dela. */
export function useShopAccent(color: string | null | undefined) {
  const { setShopAccent } = useAppearance()
  useEffect(() => {
    setShopAccent(isAccent(color) ? color : null)
    return () => setShopAccent(null)
  }, [color, setShopAccent])
}
