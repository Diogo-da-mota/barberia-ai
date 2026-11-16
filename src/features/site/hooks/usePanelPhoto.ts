import { useQuery } from "@tanstack/react-query"
import { fetchPanelPhotos, type PanelPhoto } from "../api"

export const panelPhotosKey = (shopId: string) => ["panel-photos", shopId] as const

/**
 * Foto do painel da barbearia (uma consulta só para todas): undefined enquanto carrega; null = foto padrão (sem foto própria,
 * sem barbearia ou erro).
 */
export function usePanelPhoto(shopId: string | null | undefined, photo: PanelPhoto | undefined): string | null | undefined {
  const query = useQuery({ queryKey: panelPhotosKey(shopId ?? ""), queryFn: () => fetchPanelPhotos(shopId!), enabled: Boolean(shopId && photo), staleTime: 1000 * 60 * 5 })
  if (!shopId || !photo || query.isError) return null
  return query.data?.[photo]
}
