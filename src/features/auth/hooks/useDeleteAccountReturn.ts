import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"

/** Quem saiu para confirmar com o Google: ao voltar, o pop-up só reabre para a MESMA conta (outra conta escolhida = nada). */
export const REAUTH_KEY = "barberia-reauth-excluir"
export const RETURN_PARAM = "conta"

/** Reabre o pop-up quando a pessoa volta do Google (endereço com ?conta=excluir) com a mesma conta que pediu. */
export function useDeleteAccountReturn(userId: string | undefined, reopen: () => void) {
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (!userId) return
    const params = new URLSearchParams(location.search)
    if (params.get(RETURN_PARAM) !== "excluir") return
    params.delete(RETURN_PARAM)
    const rest = params.toString()
    navigate({ pathname: location.pathname, search: rest ? `?${rest}` : "" }, { replace: true })
    let expected: string | null = null
    try {
      expected = sessionStorage.getItem(REAUTH_KEY)
      sessionStorage.removeItem(REAUTH_KEY)
    } catch {
      // sem armazenamento: a pessoa abre o pop-up de novo
    }
    if (expected === userId) reopen()
  }, [userId, location.pathname, location.search, navigate, reopen])
}
