import type { ReactNode } from "react"
import { Clock, Scissors } from "lucide-react"
import { cn } from "@/lib/utils"
import { ImageCarousel } from "@/ui/carousel"
import { formatDuration, formatPrice, type Service } from "../domain"

/**
 * Card de serviço. É ÚNICO: o painel (/dashboard/servicos) e a página pública (/:slug) usam este componente,
 * então qualquer mudança de visual vale para as duas telas. Só mudam as ações:
 *  - `action` (página pública): o botão Reservar, ao lado do preço (quebra de linha em vez de sobrepor);
 *  - `side` (painel): coluna na borda direita, com o lápis em cima e a lixeira embaixo.
 */
export function ServiceCard({
  service,
  photos,
  action,
  side,
  selected = false,
  onOpen,
  badge,
  variant = "padrao",
  highlight = false,
  className,
}: {
  service: Service
  /** URLs das fotos do serviço (até 5). Vazio = quadro padrão. */
  photos: string[]
  action?: ReactNode
  side?: ReactNode
  selected?: boolean
  /** Página pública: clicar no card ou na foto abre o pop-up de detalhes (o título é o botão para teclado). */
  onOpen?: () => void
  /** Selo ao lado do nome (ex.: "Mais vendido"), só quando os dados reais confirmam. */
  badge?: ReactNode
  /** "painel": cartão largo do painel (foto grande, descrição, duração e preço na cor de destaque, ações no canto). */
  variant?: "padrao" | "painel"
  /** Destaque (borda na cor de destaque), ex.: o mais vendido. */
  highlight?: boolean
  className?: string
}) {
  if (variant === "painel") {
    return (
      <article
        data-testid="service-card" data-selected={selected ? "true" : "false"}
        className={cn("flex min-h-44 w-full overflow-hidden rounded-2xl border bg-card shadow-sm", highlight ? "border-primary/70 bg-primary/5 shadow-[0_0_0_1px_var(--primary)]/20" : "border-border", className)}
      >
        <div className="relative w-[38%] max-w-52 min-w-28 shrink-0 self-stretch bg-surface-alt">
          {photos.length > 0 ? (
            <ImageCarousel fill images={photos} alt={`Fotos de ${service.nome}`} className="absolute inset-0 h-full w-full" />
          ) : (
            <div data-testid="service-photo-fallback" aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/25 via-primary/10 to-surface-alt text-primary">
              <Scissors className="h-10 w-10 opacity-80" />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 font-display text-xl leading-tight font-semibold tracking-wide">
              <span className="break-words">{service.nome}</span>
              {!service.ativo && <span className="ml-2 rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 align-middle text-xs font-medium text-warning">Inativo</span>}
            </h3>
            {side && <div className="flex shrink-0 gap-1.5">{side}</div>}
          </div>
          {service.descricao && <p className="line-clamp-3 text-sm text-muted-foreground">{service.descricao}</p>}
          {badge && <div className="flex">{badge}</div>}
          <div className="mt-auto flex items-center gap-4 border-t border-border/70 pt-3">
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums"><Clock className="h-4 w-4" aria-hidden="true" />{formatDuration(service.duracao_min)}</span>
            <span aria-hidden="true" className="h-5 w-px bg-border" />
            <span className="font-display text-xl font-semibold text-primary tabular-nums">{formatPrice(service.preco_centavos)}</span>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article
      data-testid="service-card"
      data-selected={selected ? "true" : "false"}
      onClick={onOpen ? (event) => { if (!(event.target as HTMLElement).closest("button, a")) onOpen() } : undefined}
      className={cn(
        "flex h-full min-h-32 w-full overflow-hidden rounded-card border bg-card shadow-sm transition-[transform,box-shadow,border-color] duration-200",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border",
        // página pública: o card responde ao ponteiro (sobe 2px); no painel fica parado
        action && "motion-safe:hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
        onOpen && "cursor-pointer",
        className,
      )}
    >
      {/* foto QUADRADA rente às bordas de cima, de baixo e da esquerda; lado direito reto */}
      <div className="w-32 shrink-0 self-stretch bg-surface-alt">
        <div className="aspect-square w-full">
          {photos.length > 0 ? (
            <ImageCarousel fill images={photos} alt={`Fotos de ${service.nome}`} className="h-full w-full" />
          ) : (
            <div data-testid="service-photo-fallback" aria-hidden="true" className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
              <Scissors className="h-8 w-8" />
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3 sm:p-4">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 font-display text-lg leading-tight font-semibold tracking-wide">
            <span className="truncate">
              {onOpen ? (
                <button type="button" onClick={onOpen} aria-label={`Ver detalhes de ${service.nome}`} className="max-w-full truncate rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  {service.nome}
                </button>
              ) : service.nome}
            </span>
            {badge}
            {!service.ativo && <span className="rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">Inativo</span>}
          </h3>
          {service.descricao && <p className="line-clamp-2 text-sm text-muted-foreground">{service.descricao}</p>}
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex shrink-0 flex-col">
            <span className="font-display text-lg font-semibold text-income tabular-nums">{formatPrice(service.preco_centavos)}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{formatDuration(service.duracao_min)}</span>
          </div>
          {action && <div className="ml-auto flex shrink-0 items-center">{action}</div>}
        </div>
      </div>

      {/* painel: lápis no canto direito de cima, lixeira no canto direito de baixo */}
      {side && <div className="flex shrink-0 flex-col justify-between p-1">{side}</div>}
    </article>
  )
}
