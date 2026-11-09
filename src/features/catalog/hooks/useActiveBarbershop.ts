import { useQuery } from "@tanstack/react-query"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { fetchMyBarbershops } from "@/features/home/api"
import type { MyBarbershop } from "@/features/home/domain"

export type ActiveBarbershop = {
  state: "loading" | "error" | "unavailable" | "none" | "ready"
  active: MyBarbershop | null
  canManage: boolean
  retry: () => void
  isRetrying: boolean
}

/**
 * Barbearia usada nas telas de gestão: a primeira em que o usuário é da equipe.
 * Quem só tem vínculo de cliente não gerencia nada. A troca entre várias barbearias ainda não existe (F02-05).
 * Isto só decide o que a tela mostra: quem protege os dados é o RLS no banco.
 */
export function useActiveBarbershop(): ActiveBarbershop {
  const { session, loading } = useAuth()
  const userId = session?.user.id

  const query = useQuery({
    queryKey: ["my-barbershops", userId],
    queryFn: () => fetchMyBarbershops(userId!),
    enabled: Boolean(userId),
  })

  const base = { retry: () => void query.refetch(), isRetrying: query.isFetching }
  const result = query.data

  if (query.isError) return { ...base, state: "error", active: null, canManage: false }
  if (loading || !result) return { ...base, state: "loading", active: null, canManage: false }
  if (result.status === "unavailable") return { ...base, state: "unavailable", active: null, canManage: false }

  const staff = result.barbershops.filter((shop) => shop.papel !== "cliente")
  const active = staff[0] ?? null
  if (!active) return { ...base, state: "none", active: null, canManage: false }
  return { ...base, state: "ready", active, canManage: active.papel === "proprietario" || active.papel === "gerente" }
}
