import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { Shell } from "@/app/Shell"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { EmptyState } from "@/ui/finance"
import { PageBanner, type BannerName } from "@/ui/page-banner"
import { Skeleton } from "@/ui/skeleton"
import type { MyBarbershop } from "@/features/home/domain"
import type { ActiveBarbershop } from "../hooks/useActiveBarbershop"

type CatalogFrameProps = {
  title: string
  description: string
  action?: ReactNode
  /** Telas com duas colunas (ex.: edição + pré-visualização) usam a largura ampla. */
  wide?: boolean
  /** Faixa fotográfica discreta atrás do título (só no tema escuro). */
  banner?: BannerName
  /** Risca curta na cor de destaque acima do título (padrão: aparece nas telas com faixa de foto). */
  bar?: boolean
  /** Largura máxima: padrão 768px, `wide` 1120px, `full` 1480px (telas operacionais de duas colunas). */
  full?: boolean
  /** Cabeçalho próprio no lugar do padrão (título, descrição e faixa); a tela passa a ser dona do `<h1>`. */
  header?: ReactNode
  children: ReactNode
}

/** Moldura das telas de lista (768px, Design System seção 5). */
export function CatalogFrame({ title, description, action, wide, banner, bar, full, header, children }: CatalogFrameProps) {
  const showBar = bar ?? Boolean(banner)
  return (
    <Shell>
      <div className={cn("mx-auto flex w-full flex-col gap-6", full ? "max-w-[1480px]" : wide ? "max-w-[1120px]" : "max-w-[768px]")}>
        {header ?? (() => {
          const head = (
            <header className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                {showBar && <span aria-hidden="true" className="mb-1 block h-[3px] w-10 rounded-full bg-primary" />}
                <h1 className="font-display text-2xl font-bold tracking-wide sm:text-[28px]">{title}</h1>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
              {action}
            </header>
          )
          return banner ? <PageBanner name={banner} className="[.dark_&]:px-4 [.dark_&]:sm:px-5">{head}</PageBanner> : head
        })()}
        {children}
      </div>
    </Shell>
  )
}

type ShopGateProps = {
  gate: ActiveBarbershop
  children: (shop: MyBarbershop, canManage: boolean) => ReactNode
}

/** Resolve a barbearia ativa antes de mostrar a tela, com os estados de carregamento, erro e vazio. */
export function ShopGate({ gate, children }: ShopGateProps) {
  switch (gate.state) {
    case "loading":
      return (
        <div role="status" aria-label="Carregando sua barbearia" className="flex flex-col gap-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      )
    case "error":
      return (
        <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm font-semibold">Não foi possível carregar sua barbearia</p>
          <Button variant="outline" className="h-11 md:h-10" disabled={gate.isRetrying} onClick={gate.retry}>
            Tentar novamente
          </Button>
        </div>
      )
    case "unavailable":
      return (
        <EmptyState
          title="Cadastro de barbearias indisponível"
          description="O banco de dados ainda está sendo preparado."
        />
      )
    case "none":
      return (
        <EmptyState
          title="Crie sua barbearia primeiro"
          description="Serviços e equipe pertencem a uma barbearia."
          action={
            <Button asChild className="h-11 md:h-10">
              <Link to="/dashboard/barbearias/nova">Criar barbearia</Link>
            </Button>
          }
        />
      )
    default:
      return <>{children(gate.active!, gate.canManage)}</>
  }
}
