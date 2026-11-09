import type { PublicShopData } from "@/features/booking/domain"
import { servicePhotos } from "@/features/catalog/domain"
import { publicMediaUrl } from "../api"
import type { SiteView } from "./types"

type Source = Pick<PublicShopData, "nome" | "descricao" | "endereco" | "telefone" | "services" | "professionals"> & { logoPath?: string | null; capaPath?: string | null; galeria?: string[]; /** Rascunho de recorte: URLs temporárias que valem no lugar das salvas. */ logoUrlOverride?: string | null; capaUrlOverride?: string | null }

/** Monta o contrato de dados dos modelos a partir dos dados reais da barbearia (página pública e prévia usam esta mesma função). */
export function buildSiteView(src: Source): SiteView {
  const url = (path: string) => publicMediaUrl(path) ?? ""
  return {
    nome: src.nome,
    descricao: src.descricao?.trim() || null,
    endereco: src.endereco,
    telefone: src.telefone,
    logoUrl: src.logoUrlOverride ?? publicMediaUrl(src.logoPath),
    capaUrl: src.capaUrlOverride ?? publicMediaUrl(src.capaPath),
    galeriaUrls: (src.galeria ?? []).map(url).filter(Boolean),
    services: src.services.map((s) => ({ ...s, descricao: s.descricao ?? null, photos: servicePhotos(s, url).filter(Boolean) })),
    professionals: src.professionals,
  }
}
