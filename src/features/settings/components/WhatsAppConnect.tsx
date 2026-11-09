import { Loader2, MessageSquare, Phone, ShieldCheck, Unplug, X } from "lucide-react"
import { Button } from "@/ui/button"
import type { WhatsAppConnection } from "../useWhatsAppConnection"

const STATE_ICON: Record<string, React.ReactNode> = {
  open: <ShieldCheck className="h-4 w-4 text-income" />,
  connecting: <Loader2 className="h-4 w-4 animate-spin text-warning" />,
  close: <Unplug className="h-4 w-4 text-muted-foreground" />,
  not_found: <MessageSquare className="h-4 w-4 text-muted-foreground" />,
}

/** 55 + DDD + 9 ou 8 dígitos (a Evolution às vezes devolve o número sem o 9 extra). */
const formatNumber = (n: string) => `+${n.length === 12 ? n.replace(/(\d{2})(\d{2})(\d{4})(\d{4})/, "$1 $2 $3-$4") : n.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, "$1 $2 $3-$4")}`

/** Estado vivo da instância: Não configurado, Aguardando leitura do QR, Conectado… */
export function WhatsAppStateBadge({ connection }: { connection: WhatsAppConnection }) {
  return (
    <span role="status" aria-label="Estado do WhatsApp" className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-muted">
      {STATE_ICON[connection.stateKey]} {connection.stateLabel}
    </span>
  )
}

/**
 * Botão "Conectar WhatsApp", QR Code e estado conectado. O mesmo em Mais › WhatsApp e em Mensagens › Notificações.
 * `compact`: sem o quadro vazio grande e sem "Desconectar" (desconectar fica em Mais › WhatsApp).
 */
export function WhatsAppConnect({ connection, compact = false }: { connection: WhatsAppConnection; compact?: boolean }) {
  const { status, qr, error, requesting, isConnected, loading, startQr, disconnect, disconnecting } = connection

  const handleDisconnect = () => {
    if (confirm("Tem certeza que deseja desconectar o WhatsApp? Isso removerá a instância do servidor Evolution.")) disconnect()
  }

  const connectButton = (
    // desconectado: vermelho (danger), independente da cor de destaque
    <Button variant="destructive" onClick={startQr} disabled={requesting} className={compact ? "h-11 md:h-10" : "mt-3"}>
      {requesting ? (
        <> <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> Conectando… </>
      ) : (
        <> <Phone className="h-4 w-4 mr-2" aria-hidden="true" /> Conectar WhatsApp </>
      )}
    </Button>
  )
  const errorText = error && <p role="alert" className={compact ? "text-sm text-destructive" : "mx-auto mt-2 max-w-sm text-sm text-destructive"}>{error}</p>

  if (loading && !qr) {
    return (
      <p role="status" aria-label="Verificando a conexão do WhatsApp" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Verificando conexão…
      </p>
    )
  }

  if (qr && !isConnected) {
    return (
      <div className="flex flex-col items-center gap-4">
        {qr.image ? (
          <img src={qr.image} alt="QR Code para conectar WhatsApp" className="aspect-square h-auto w-64 max-w-full rounded-md border border-border bg-white p-2" />
        ) : (
          <div className="flex aspect-square w-64 max-w-full items-center justify-center rounded-md border border-dashed border-border">
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Gerando QR Code" />
          </div>
        )}
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Escaneie com o WhatsApp do celular</p>
          <p className="text-xs text-muted-foreground mt-1">Configurações → Aparelhos conectados → Conectar aparelho</p>
        </div>
        {qr.pairingCode && (
          <div className="text-center p-3 rounded-md bg-muted">
            <p className="text-sm">Ou use o código de emparelhamento:</p>
            <code className="text-lg font-mono tracking-widest">{qr.pairingCode}</code>
          </div>
        )}
      </div>
    )
  }

  if (isConnected) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-income/10"><Phone className="h-5 w-5 text-income" aria-hidden="true" /></div>
          <div className="min-w-0">
            <p className="font-medium">WhatsApp conectado</p>
            {status.profileName && <p className="truncate text-sm text-muted-foreground">{status.profileName}</p>}
            <p className="text-sm text-muted-foreground tabular-nums">{status.number ? formatNumber(status.number) : "Número não disponível"}</p>
          </div>
        </div>
        {!compact && (
          // conectado: verde (income); texto na cor do fundo para manter contraste nos dois temas
          <Button onClick={handleDisconnect} disabled={disconnecting} className="w-full bg-income text-background hover:bg-income/90 sm:w-auto">
            {disconnecting ? (
              <> <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> Desconectando… </>
            ) : (
              <> <X className="h-4 w-4 mr-2" aria-hidden="true" /> Desconectar </>
            )}
          </Button>
        )}
      </div>
    )
  }

  if (compact) {
    return (
      <div className="flex flex-col items-start gap-2">
        {errorText}
        {connectButton}
      </div>
    )
  }

  return (
    <div className="text-center py-8 rounded-card border border-dashed border-border">
      <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-3" aria-hidden="true" />
      <p className="text-muted-foreground">
        {status.state === "not_found" ? "Nenhuma instância configurada ainda." : "WhatsApp desconectado."}
      </p>
      {errorText}
      {connectButton}
    </div>
  )
}
