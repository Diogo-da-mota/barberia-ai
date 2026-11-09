import { useQuery } from "@tanstack/react-query"
import { fetchMedia, publicMediaUrl } from "../api"

/** URL da logo da barbearia (a mesma de /dashboard/site). Sem logo ou sem permissão de ler: null, e a tela mostra o ícone padrão. */
export function useShopLogo(shopId: string | null | undefined): string | null {
  const media = useQuery({ queryKey: ["site-media", shopId], queryFn: () => fetchMedia(shopId!), enabled: Boolean(shopId), staleTime: 1000 * 60 * 5 })
  const logo = media.data?.find((item) => item.kind === "logo")
  return logo ? publicMediaUrl(logo.storage_path) : null
}
