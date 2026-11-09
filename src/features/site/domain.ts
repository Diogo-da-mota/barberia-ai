import type { CSSProperties } from "react"

export type MediaKind = "logo" | "capa" | "galeria"
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const MAX_GALLERY = 8
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const

export { ACCENTS, isAccent, type AccentKey } from "@/lib/accent"
import { ACCENTS, isAccent } from "@/lib/accent"

export function accentStyle(value: string | null | undefined): CSSProperties | undefined {
  if (!isAccent(value)) return undefined
  const { primary, foreground } = ACCENTS[value]
  return { "--primary": primary, "--primary-foreground": foreground, "--color-primary": primary, "--color-primary-foreground": foreground } as CSSProperties
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Validação de conveniência no navegador. A validação que vale é a do servidor (bucket e register_media). */
export function validateImage(file: { type: string; size: number }, maxBytes = MAX_IMAGE_BYTES): string | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return "Use uma imagem JPEG, PNG ou WebP."
  if (file.size <= 0) return "O arquivo está vazio."
  if (file.size > maxBytes) return `A imagem deve ter no máximo ${Math.round(maxBytes / 1024 / 1024)} MB.`
  return null
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

export function buildMediaPath(shopId: string, kind: MediaKind, mime: string, id: string): string {
  return `${shopId}/${kind}-${id}.${EXT[mime] ?? "bin"}`
}

const MEDIA_MESSAGES: Record<string, string> = {
  invalid_media: "Imagem inválida. Use JPEG, PNG ou WebP de até 2 MB.",
  media_not_found: "O envio da imagem não foi concluído. Tente novamente.",
  media_limit: "A galeria aceita no máximo 8 imagens. Remova uma antes.",
  invalid_site: "Confira a descrição, a cor, o endereço e o telefone.",
  invalid_template: "Escolha um dos modelos disponíveis.",
  invalid_slug: "O link deve ter de 3 a 60 letras minúsculas, números e hífens.",
  slug_taken: "Este link já está em uso. Escolha outro.",
  slug_reserved: "Este endereço é reservado pelo sistema. Escolha outro.",
  forbidden: "Você não tem permissão para esta ação.",
}
export function siteErrorMessage(error: unknown): string {
  const { message } = (error ?? {}) as { message?: string }
  if (message?.includes("slug_not_reserved")) return MEDIA_MESSAGES.slug_reserved // a constraint do banco (migration 0014) recusou
  const key = Object.keys(MEDIA_MESSAGES).find((k) => message === k)
  return key ? MEDIA_MESSAGES[key] : "Não foi possível concluir. Tente novamente."
}

export type Seo = { title: string; description: string; image?: string }

export function seoFor(shop: { nome: string; descricao?: string | null; endereco?: string | null }): Seo {
  const base = shop.descricao?.trim() || `Agende seu horário na ${shop.nome}.${shop.endereco ? ` ${shop.endereco}` : ""}`
  return { title: `${shop.nome} | Agende online`, description: base.length > 160 ? `${base.slice(0, 157)}...` : base }
}

function setMeta(doc: Document, attr: "name" | "property", key: string, content: string) {
  let el = doc.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = doc.createElement("meta")
    el.setAttribute(attr, key)
    doc.head.appendChild(el)
  }
  el.setAttribute("content", content)
}

export function applySeo(doc: Document, seo: Seo): void {
  doc.title = seo.title
  setMeta(doc, "name", "description", seo.description)
  setMeta(doc, "property", "og:title", seo.title)
  setMeta(doc, "property", "og:description", seo.description)
  setMeta(doc, "property", "og:type", "website")
  if (seo.image) setMeta(doc, "property", "og:image", seo.image)
}
