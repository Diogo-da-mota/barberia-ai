import type { PublicProfessional, PublicService } from "@/features/booking/domain"

/** Os cinco modelos de site. O valor é o que o banco guarda em `barbershops.template` (migration 0011). */
export const TEMPLATE_IDS = ["urbano", "classico", "minimalista", "moderno", "premium"] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]
export const DEFAULT_TEMPLATE: TemplateId = "urbano"

export const isTemplateId = (value: unknown): value is TemplateId => typeof value === "string" && (TEMPLATE_IDS as readonly string[]).includes(value)

export const TEMPLATE_INFO: Record<TemplateId, { nome: string; resumo: string }> = {
  urbano: { nome: "Urbano", resumo: "Preto, moderno e marcante." },
  classico: { nome: "Clássico", resumo: "Elegante e tradicional." },
  minimalista: { nome: "Minimalista", resumo: "Limpo, claro e objetivo." },
  moderno: { nome: "Moderno", resumo: "Fotografia forte e composição contemporânea." },
  premium: { nome: "Premium", resumo: "Sofisticado, com estética editorial." },
}

export type SiteViewService = PublicService & { photos: string[] }

/**
 * Contrato único de dados dos cinco modelos: tudo o que um modelo pode mostrar. Os modelos só APRESENTAM estes dados;
 * a reserva (profissional, horários, confirmação) é a mesma e mora em PublicShop, que recebe os cliques por `onReserve`/`onOpenService`.
 */
export type SiteView = {
  nome: string
  descricao: string | null
  endereco: string | null
  telefone: string | null
  logoUrl: string | null
  capaUrl: string | null
  galeriaUrls: string[]
  services: SiteViewService[]
  professionals: PublicProfessional[]
}

export type TemplateProps = {
  view: SiteView
  onReserve: (serviceId: string) => void
  onOpenService: (serviceId: string) => void
  /** Nível do título com o nome da barbearia: 1 na página publicada, 2 onde já existe um h1 (prévia). */
  headingLevel?: 1 | 2
}
