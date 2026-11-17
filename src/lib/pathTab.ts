import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"

/**
 * Aba no caminho da rota: `/financeiro` é a primeira aba e `/financeiro/despesas` a aba Despesas (sem `?aba=`).
 * Link antigo com `?aba=` é convertido para o caminho novo (ou para `moved[aba]`, quando a aba mudou de tela).
 * Segmento desconhecido vale como a primeira aba.
 */
export function usePathTab<T extends string>(base: string, tabs: readonly T[], moved: Record<string, string> = {}): [T, (value: string) => void] {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const pick = (v: string | null) => tabs.find((t) => t === v)
  const path = (value: T) => (value === tabs[0] ? base : `${base}/${value}`)
  const segment = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1).split("/")[0] : null
  const legacy = new URLSearchParams(search).get("aba")
  const tab = pick(segment) ?? pick(legacy) ?? tabs[0]
  const rest = () => { const next = new URLSearchParams(search); next.delete("aba"); return next.toString() }
  useEffect(() => {
    if (legacy === null) return
    void navigate(moved[legacy] ?? { pathname: path(tab), search: rest() }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage ao link antigo
  }, [legacy])
  return [tab, (value) => void navigate({ pathname: path(pick(value) ?? tabs[0]), search: rest() })]
}
