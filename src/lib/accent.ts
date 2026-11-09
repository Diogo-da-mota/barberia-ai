/**
 * Cores de destaque do site inteiro (público, painel, pop-ups). Fonte única dos valores: o CSS em `index.css`
 * (`html[data-accent="…"]`) repete estes números e o teste `accent.test.ts` confere que não divergem.
 * Cada cor traz o texto do botão (`foreground`) e a cor de link para o tema claro e para o escuro, todos com contraste ≥ 4,5:1.
 */
export const ACCENTS = {
  ambar: { label: "Âmbar", primary: "#FFB000", foreground: "#15171A", linkLight: "#8A5700", linkDark: "#FFBE33" },
  azul: { label: "Azul", primary: "#3B82F6", foreground: "#0B1220", linkLight: "#1D4ED8", linkDark: "#7CB0FF" },
  verde: { label: "Verde", primary: "#22C55E", foreground: "#0B1220", linkLight: "#166534", linkDark: "#4ADE80" },
  vermelho: { label: "Vermelho", primary: "#EF4444", foreground: "#0B1220", linkLight: "#B91C1C", linkDark: "#FF8A80" },
  violeta: { label: "Violeta", primary: "#7C3AED", foreground: "#FFFFFF", linkLight: "#6D28D9", linkDark: "#C4B5FD" },
} as const

export type AccentKey = keyof typeof ACCENTS
/** "padrao" = escolha explícita de ficar no padrão do sistema (âmbar), mesmo numa barbearia com cor própria. */
export type AccentChoice = AccentKey | "padrao"

export const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[]

export function isAccent(value: unknown): value is AccentKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ACCENTS, value)
}

export function isAccentChoice(value: unknown): value is AccentChoice {
  return value === "padrao" || isAccent(value)
}

export const ACCENT_STORAGE_KEY = "barberia:accent"

/** Cópia local da escolha do usuário: só serve para pintar a tela antes de a conta carregar. A verdade fica na conta. */
export function readStoredAccent(): AccentChoice | null {
  try {
    const value = localStorage.getItem(ACCENT_STORAGE_KEY)
    return isAccentChoice(value) ? value : null
  } catch {
    return null
  }
}

export function writeStoredAccent(choice: AccentChoice | null) {
  try {
    if (choice) localStorage.setItem(ACCENT_STORAGE_KEY, choice)
    else localStorage.removeItem(ACCENT_STORAGE_KEY)
  } catch {
    /* sem armazenamento: a cor continua valendo na conta */
  }
}

/** A cor que vale na tela: a escolha do usuário; sem escolha, a cor da barbearia que ele está vendo; senão, o padrão. */
export function effectiveAccent(choice: AccentChoice | null, shop: AccentKey | null): AccentKey | null {
  if (choice === "padrao") return null
  return choice ?? shop
}
