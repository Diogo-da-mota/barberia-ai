import type { CSSProperties } from "react"
import type { TemplateId } from "./types"

type Palette = { background: string; card: string; surfaceAlt: string; foreground: string; muted: string; border: string }

/**
 * Cada modelo tem a própria base de cores (preto, marfim, branco…), isolada na raiz do modelo por variáveis CSS.
 * A COR DE DESTAQUE não está aqui: ela continua vindo de `--primary` (cor da barbearia ou da conta), em todos os modelos.
 * Os tokens do Tailwind (`bg-card`, `text-muted-foreground`…) são variáveis `--color-*`, então as duas famílias são sobrescritas.
 */
const PALETTES: Record<TemplateId, Palette> = {
  urbano: { background: "#09090B", card: "#111214", surfaceAlt: "#1A1C20", foreground: "#F2F2EC", muted: "#A2A7AF", border: "#2A2D32" },
  classico: { background: "#F5EFE3", card: "#FBF7EE", surfaceAlt: "#EBE2D0", foreground: "#2A2118", muted: "#6B5D4B", border: "#D6C9AE" },
  minimalista: { background: "#FFFFFF", card: "#FFFFFF", surfaceAlt: "#F4F4F5", foreground: "#111113", muted: "#5C5C63", border: "#E4E4E7" },
  moderno: { background: "#0B0D10", card: "#12161B", surfaceAlt: "#1B2128", foreground: "#F4F6F8", muted: "#9AA4AF", border: "#262E37" },
  premium: { background: "#0E0C0A", card: "#16130F", surfaceAlt: "#211D17", foreground: "#F3EDE2", muted: "#A99F8F", border: "#2E2820" },
}

/** Modelos de base clara (texto escuro): quem coloca texto colorido sobre eles precisa de outra mistura de cor para manter o contraste. */
export const isLightTemplate = (template: TemplateId): boolean => template === "classico" || template === "minimalista"

export function paletteStyle(template: TemplateId): CSSProperties {
  const p = PALETTES[template]
  const pairs: Record<string, string> = {
    background: p.background, card: p.card, "surface-alt": p.surfaceAlt, foreground: p.foreground, "muted-foreground": p.muted, border: p.border, input: p.border,
  }
  const style: Record<string, string> = {}
  for (const [name, value] of Object.entries(pairs)) { style[`--${name}`] = value; style[`--color-${name}`] = value }
  return style as CSSProperties
}
