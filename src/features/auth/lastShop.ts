import { shopBookingsPath } from "@/lib/shopPaths"

/** Última barbearia visitada neste navegador: leva o cliente sem login de volta à porta certa. */
const KEY = "barberia:ultima-barbearia"
const SLUG = /^[a-z0-9-]{1,80}$/

export function rememberShop(slug: string) {
  try {
    if (SLUG.test(slug)) localStorage.setItem(KEY, slug)
  } catch {
    /* navegador sem armazenamento: só perde o atalho */
  }
}

export function lastShop(): string | null {
  try {
    const slug = localStorage.getItem(KEY)
    return slug && SLUG.test(slug) ? slug : null
  } catch {
    return null
  }
}

/** Para onde o cliente sem sessão vai ao abrir /minhas-reservas: o acesso da última barbearia, ou o acesso neutro. */
export function clientAccessPath(): string {
  const slug = lastShop()
  return slug ? shopBookingsPath(slug) : "/acesso"
}
