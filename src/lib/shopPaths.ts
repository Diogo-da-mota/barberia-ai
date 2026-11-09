/**
 * Endereços públicos das barbearias: o slug fica na raiz (`/:slug`, `/:slug/minhas-reservas`). Tudo que monta um link de barbearia
 * passa por aqui, e as palavras que o sistema já usa na raiz ficam RESERVADAS (nenhuma barbearia pode ter esses endereços).
 * A lista é repetida no banco (migration 0014, `private.is_reserved_slug`); o teste `shopPaths.test.ts` confere que as duas são iguais.
 */
export const RESERVED_SLUGS = [
  // rotas do sistema (têm prioridade sobre /:slug)
  "dashboard", "login", "auth", "acesso", "convite", "minhas-reservas", "e",
  // áreas e nomes que o produto pode usar na raiz
  "site", "site-albuns", "admin", "app", "painel", "entrar", "cadastro", "cadastrar", "planos", "precos", "suporte", "ajuda", "termos", "privacidade", "contato", "sobre", "blog",
  // infraestrutura, arquivos estáticos e desenvolvimento
  "api", "assets", "images", "static", "public", "src", "robots", "sitemap", "manifest", "favicon", "health", "status", "www",
] as const

const RESERVED = new Set<string>(RESERVED_SLUGS)

export const isReservedSlug = (slug: string): boolean => RESERVED.has(slug.trim().toLowerCase())

/** `/barbearia-do-tico` */
export const shopPath = (slug: string): string => `/${encodeURIComponent(slug)}`
/** `/barbearia-do-tico/minhas-reservas` */
export const shopBookingsPath = (slug: string): string => `${shopPath(slug)}/minhas-reservas`
/** Endereço completo no domínio em que o painel está aberto: localhost em desenvolvimento, o domínio real em produção. */
export const shopUrl = (slug: string): string => `${window.location.origin}${shopPath(slug)}`
/** Seções da página pública que têm endereço próprio: /slug/servicos, /slug/profissionais, /slug/galeria e /slug/contato. */
export const SHOP_SECTIONS = ["servicos", "profissionais", "galeria", "contato"] as const
export type ShopSection = (typeof SHOP_SECTIONS)[number]
export const isShopSection = (value: string | undefined): value is ShopSection => (SHOP_SECTIONS as readonly string[]).includes(value ?? "")
/** `/barbearia-do-tico/servicos`: abre a página da barbearia já rolada até a seção (nada de `#` na URL). */
export const shopSectionPath = (slug: string, section: ShopSection): string => `${shopPath(slug)}/${section}`
