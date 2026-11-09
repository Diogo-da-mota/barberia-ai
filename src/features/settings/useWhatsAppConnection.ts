import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { connectWhatsApp, disconnectWhatsApp, getWhatsAppStatus, type WhatsAppStatus } from "./whatsapp-api"
import { toast } from "@/ui/sonner"

/** Fluxo do wacrm: com o QR na tela, consulta o estado a cada 3 s e renova o QR a cada 30 s (no máximo 8 vezes). */
const POLL_MS = 3000
const QR_REFRESH_MS = 30000
const QR_MAX_REFRESHES = 8

export const WHATSAPP_STATE_LABEL: Record<string, string> = {
  open: "Conectado",
  connecting: "Conectando…",
  close: "Desconectado",
  not_found: "Não configurado",
}

const EMPTY: WhatsAppStatus = { provider: null, connected: false, state: "not_found", number: null, profileName: null }

export type WhatsAppConnection = ReturnType<typeof useWhatsAppConnection>

/**
 * Conexão do WhatsApp da barbearia pela instância Evolution (connect-instance / instance-status / disconnect-instance).
 * Uma lógica só para Mais › WhatsApp e Mensagens › Notificações.
 */
export function useWhatsAppConnection(shopId: string) {
  const queryClient = useQueryClient()
  const statusKey = ["whatsapp-status", shopId]
  // Estado vivo da instância (instance-status consulta a Evolution: 0,4–1,3 s). Em cache: uma chamada só, compartilhada
  // por Mais › Dados e Mensagens › Notificações; até a primeira resposta a tela mostra "Verificando conexão…".
  const statusQuery = useQuery({ queryKey: statusKey, queryFn: () => getWhatsAppStatus(shopId), staleTime: 15_000, retry: false })
  const status: WhatsAppStatus = statusQuery.data ? { ...EMPTY, ...statusQuery.data } : EMPTY
  const setStatus = useCallback((s: WhatsAppStatus) => queryClient.setQueryData(["whatsapp-status", shopId], s), [queryClient, shopId])
  const [qr, setQr] = useState<{ image: string | null; pairingCode: string | null } | null>(null)
  const [error, setError] = useState("")
  const refreshes = useRef(0)
  const { refetch } = statusQuery

  const loadStatus = useCallback(async (): Promise<WhatsAppStatus | null> => {
    const r = await refetch()
    if (r.error) console.error("[WhatsApp] Erro ao carregar status:", r.error)
    return r.data ?? null
  }, [refetch])

  const markConnected = useCallback(() => {
    setQr(null)
    setError("")
    toast.success("WhatsApp conectado!")
    // a faixa do canal em Mensagens, o card de Notificações e a fila leem integration_accounts
    void queryClient.invalidateQueries({ queryKey: ["integrations", shopId] })
  }, [queryClient, shopId])

  const { mutate: requestQr, isPending: requesting } = useMutation({
    mutationFn: () => connectWhatsApp(shopId),
    onMutate: () => setError(""),
    onSuccess: (data) => {
      setStatus({ ...EMPTY, ...data })
      if (data.connected) markConnected()
      else setQr({ image: data.qr ?? null, pairingCode: data.pairingCode ?? null })
    },
    onError: (err) => {
      setQr(null)
      setError(err instanceof Error ? err.message : "Erro ao conectar")
    },
  })

  const startQr = useCallback(() => {
    refreshes.current = 0
    requestQr()
  }, [requestQr])

  // Enquanto o QR está na tela: consulta o estado e renova o QR antes de expirar.
  useEffect(() => {
    if (!qr) return
    let ativo = true
    const poll = setInterval(async () => {
      const live = await loadStatus()
      if (ativo && live?.connected) markConnected()
    }, POLL_MS)
    const renew = setInterval(() => {
      refreshes.current += 1
      if (refreshes.current > QR_MAX_REFRESHES) {
        setQr(null)
        setError("O QR Code expirou. Clique em Conectar WhatsApp para gerar outro.")
        return
      }
      requestQr()
    }, QR_REFRESH_MS)
    return () => {
      ativo = false
      clearInterval(poll)
      clearInterval(renew)
    }
  }, [qr, loadStatus, markConnected, requestQr])

  const { mutate: disconnect, isPending: disconnecting } = useMutation({
    mutationFn: () => disconnectWhatsApp(shopId),
    onSuccess: () => {
      setStatus(EMPTY)
      setQr(null)
      toast.success("WhatsApp desconectado")
      void queryClient.invalidateQueries({ queryKey: ["integrations", shopId] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Erro ao desconectar")
    },
  })

  const isConnected = status.connected
  const loading = statusQuery.isPending
  const stateKey = isConnected ? "open" : qr ? "connecting" : status.state
  const stateLabel = isConnected ? "Conectado" : qr ? "Aguardando leitura do QR" : WHATSAPP_STATE_LABEL[status.state] ?? status.state

  return { status, qr, error, requesting, isConnected, loading, stateKey, stateLabel, loadStatus, startQr, disconnect, disconnecting }
}
