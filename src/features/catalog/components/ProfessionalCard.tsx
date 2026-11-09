import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { ProfessionalPhoto } from "./ProfessionalPhoto"

/**
 * Card de profissional: foto QUADRADA rente às bordas de cima, de baixo e da esquerda (lado direito reto), nome e detalhes.
 * Painel: `side` = coluna na borda direita (lápis em cima, lixeira embaixo). Pop-up de reserva: sem ações (o card todo é o botão).
 */
export function ProfessionalCard({
  nome, photoPath, photoFallback, inactive = false, selected = false, details, side, className,
}: {
  nome: string
  photoPath?: string | null
  /** Quando não há foto (ex.: "Qualquer profissional"). Padrão: a inicial do nome. */
  photoFallback?: ReactNode
  inactive?: boolean
  selected?: boolean
  details?: ReactNode
  side?: ReactNode
  className?: string
}) {
  return (
    <article
      data-testid="professional-card"
      data-selected={selected ? "true" : "false"}
      className={cn(
        "flex h-full min-h-32 w-full overflow-hidden rounded-card border bg-card text-left shadow-sm transition-colors",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border",
        className,
      )}
    >
      <div className="w-32 shrink-0 self-stretch bg-surface-alt">
        <ProfessionalPhoto nome={nome} path={photoPath} fallback={photoFallback} className="aspect-square w-full rounded-none text-3xl" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3 sm:p-4">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 font-display text-lg leading-tight font-semibold tracking-wide">
            <span className="min-w-0 break-words">{nome}</span>
            {inactive && <span className="rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">Inativo</span>}
          </h3>
          {details && <div className="mt-1 text-sm text-muted-foreground">{details}</div>}
        </div>
      </div>
      {side && <div className="flex shrink-0 flex-col justify-between p-1">{side}</div>}
    </article>
  )
}
