import { createClient } from "@supabase/supabase-js"
import { areaOf, toAuthArea, type AuthArea } from "./shopPaths"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY devem estar definidos no .env"
  )
}

/**
 * Duas sessões independentes no mesmo navegador (mesmo projeto Supabase, mesmas permissões): o painel (dono e equipe) e o
 * cliente (páginas das barbearias). Cada uma tem a sua chave no localStorage, o seu verificador PKCE, a sua renovação de
 * token e a sua trava; entrar ou sair de uma não mexe na outra. O retorno do Google/e-mail não é lido automaticamente
 * (detectSessionInUrl: false): só /auth/callback o conclui, e no cliente da área que iniciou o fluxo.
 */
const makeClient = (area: AuthArea) =>
  createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storageKey: `barberia-auth-${area}`,
      flowType: "pkce",
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  })

export const authClients = { painel: makeClient("painel"), cliente: makeClient("cliente") } satisfies Record<AuthArea, unknown>

export const CALLBACK_PATH = "/auth/callback"

/** Área aberta nesta aba, pelo endereço. Em /auth/callback, a área que iniciou o fluxo vem no próprio link (`?area=`). */
export function currentArea(): AuthArea {
  const { pathname, search } = window.location
  if (pathname === CALLBACK_PATH) return toAuthArea(new URLSearchParams(search).get("area")) ?? "painel"
  return areaOf(pathname)
}

const areaListeners = new Set<() => void>()
export function subscribeArea(listener: () => void) {
  areaListeners.add(listener)
  return () => { areaListeners.delete(listener) }
}
/** Chamado pelo roteador a cada navegação (main.tsx), para quem depende da área acompanhar a troca. */
export const notifyAreaChange = () => areaListeners.forEach((listener) => listener())

/**
 * Banco, storage e funções sempre com a sessão da área aberta nesta aba: o painel consulta com a conta do painel e a
 * barbearia com a conta do cliente. Os módulos de dados continuam importando `supabase`, sem saber das duas sessões.
 */
// snip: Proxy em vez de passar o cliente a cada função de dados; trocar por parâmetro explícito se uma tela precisar das duas áreas ao mesmo tempo
export const supabase: typeof authClients.painel = new Proxy(authClients.painel, {
  get(_target, prop) {
    const client = authClients[currentArea()]
    const value: unknown = Reflect.get(client, prop, client)
    return typeof value === "function" ? value.bind(client) : value
  },
})

// Transição: a sessão única de antes (`sb-<projeto>-auth-token`) não é copiada para nenhuma área, pois não se sabe de qual
// porta ela veio; cada área pede um novo login.
try {
  const legacy = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`
  Object.keys(localStorage).filter((key) => key.startsWith(legacy)).forEach((key) => localStorage.removeItem(key))
} catch {
  // navegador sem armazenamento: não há sessão antiga para apagar
}
