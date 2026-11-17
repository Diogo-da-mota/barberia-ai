import { useId, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { ExternalLink, MapPin, Store } from "lucide-react"
import { Button } from "@/ui/button"
import { EmptyState, Panel, StatusBadge } from "@/ui/finance"
import { Skeleton } from "@/ui/skeleton"
import { ShopLogo } from "@/features/site/components/ShopLogo"
import type { MyBarbershopsResult } from "../api"
import { PAPEL_LABEL, type MyBarbershop } from "../domain"
import { shopPath } from "@/lib/shopPaths"

type BarbershopListProps = {
  /** Cartão estreito (ao lado dos indicadores). */
  compact?: boolean
  /** Logo da barbearia (vem de Meu site); sem ela, o ícone de loja. */
  logoUrl?: string | null
  result: MyBarbershopsResult | undefined
  isError: boolean
  isRetrying: boolean
  onRetry: () => void
}

export function BarbershopList({ result, isError, isRetrying, onRetry, compact = false, logoUrl = null }: BarbershopListProps) {
  const titleId = useId()
  // cartão compacto de uma barbearia só: o botão da página pública fica na linha do título
  const single = compact && result?.status === "ok" && result.barbershops.length === 1 ? result.barbershops[0] : null

  return (
    <section aria-labelledby={titleId} className="min-w-0">
      <Panel className={compact ? "flex h-full flex-col gap-2 p-3.5 shadow-sm" : "flex h-full flex-col gap-3 p-4 shadow-sm sm:p-6"}>
        <div className="flex items-center justify-between gap-2">
          <h2 id={titleId} className={compact ? "flex min-w-0 items-center gap-2.5 font-display text-lg font-semibold tracking-wide" : "flex items-center gap-3 font-display text-xl font-semibold tracking-wide sm:text-2xl md:min-h-9"}>
            {compact ? <ShopLogo url={logoUrl} className="h-8 w-8" /> : <Store className="h-6 w-6 text-primary" aria-hidden="true" />}
            <span className="truncate">{result?.status === "ok" && result.barbershops.length === 1 ? "Sua barbearia" : "Suas barbearias"}</span>
          </h2>
          {single && single.status === "ativo" && (
            <Button asChild variant="outline" className="h-9 shrink-0 gap-1.5 rounded-lg border-primary/70 px-3 text-sm font-semibold text-foreground hover:bg-primary/10">
              <Link to={shopPath(single.slug)}>
                Página pública
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          )}
        </div>
        <Content result={result} isError={isError} isRetrying={isRetrying} onRetry={onRetry} compact={compact} />
      </Panel>
    </section>
  )
}

function Content({ result, isError, isRetrying, onRetry, compact }: BarbershopListProps): ReactNode {
  if (isError) {
    return (
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
        <p className="text-sm font-semibold">Não foi possível carregar suas barbearias</p>
        <p className="text-sm text-muted-foreground">Verifique sua conexão e tente de novo.</p>
        <Button variant="outline" className="h-11 md:h-10" disabled={isRetrying} onClick={onRetry}>
          Tentar novamente
        </Button>
      </div>
    )
  }

  if (!result) {
    return (
      <div role="status" aria-label="Carregando suas barbearias" className="flex flex-col gap-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  if (result.status === "unavailable") {
    return (
      <EmptyState
        className="flex-1 p-4"
        title="Cadastro de barbearias indisponível"
        description="O banco de dados ainda está sendo preparado. Suas barbearias aparecem aqui quando ele estiver ativo."
      />
    )
  }

  if (result.barbershops.length === 0) {
    return (
      <EmptyState
        className="flex-1 p-4"
        title="Nenhuma barbearia vinculada"
        description="Quando você criar uma barbearia ou aceitar um convite, ela aparece aqui."
        action={
          <Button asChild className="h-11 md:h-10">
            <Link to="/barbearias/nova">Criar barbearia</Link>
          </Button>
        }
      />
    )
  }

  return (
    <ul className="divide-y divide-border">
      {result.barbershops.map((shop) => (
        <BarbershopRow key={shop.id} shop={shop} compact={compact} hideLink={compact && result.barbershops.length === 1} />
      ))}
    </ul>
  )
}

function BarbershopRow({ shop, compact, hideLink }: { shop: MyBarbershop; compact?: boolean; hideLink?: boolean }) {
  const isActive = shop.status === "ativo"

  return (
    <li className={compact ? "flex flex-col gap-2 py-2 first:pt-0 last:pb-0" : "flex flex-col gap-3 py-4 first:pt-1 last:pb-0"}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={compact ? "truncate text-base font-semibold" : "truncate font-display text-xl font-semibold tracking-wide"}>{shop.nome}</p>
          {shop.endereco && <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted-foreground"><MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />{shop.endereco}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <StatusBadge variant="default">{PAPEL_LABEL[shop.papel]}</StatusBadge>
          {!isActive && <StatusBadge variant="warning">Inativa</StatusBadge>}
        </div>
      </div>
      {isActive && !hideLink && (
        <Button asChild variant="outline" className={compact ? "h-9 w-full gap-2 rounded-lg border-primary/70 text-sm font-semibold text-foreground hover:bg-primary/10" : "h-11 w-full gap-2 rounded-xl border-primary/70 font-semibold text-foreground hover:bg-primary/10"}>
          <Link to={shopPath(shop.slug)}>
            Página pública
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      )}
    </li>
  )
}
