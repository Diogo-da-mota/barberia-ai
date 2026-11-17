import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { ProfessionalPhoto } from "./ProfessionalPhoto"

/**
 * Card de profissional: foto preenchendo a coluna esquerda inteira (de cima a baixo, recorte sem distorcer), nome e detalhes.
 * A foto fica por cima da coluna (absolute): a altura do card vem só do conteúdo (mín. 128 px), nunca do tamanho da imagem.
 * Painel: `side` = coluna na borda direita (lápis em cima, lixeira embaixo). Pop-up de reserva: sem ações (o card todo é o botão).
 */
export function ProfessionalCard({
  nome, photoPath, photoFallback, inactive = false, selected = false, details, side, className, portrait = false, nameIcon,
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
  /** Coluna da foto em 3:4 (Equipe e prévia do ajuste): o mesmo formato do recorte salvo, sem cortar de novo. */
  portrait?: boolean
  /** Ícone discreto antes do nome (ex.: origem do cadastro na Equipe). */
  nameIcon?: ReactNode
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
      <div className={cn("relative w-32 shrink-0 self-stretch bg-surface-alt", portrait && "aspect-[3/4]")}>
        <ProfessionalPhoto nome={nome} path={photoPath} fallback={photoFallback} className="absolute inset-0 h-full w-full rounded-none text-3xl" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3 sm:p-4">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 font-display text-lg leading-tight font-semibold tracking-wide">
            {nameIcon}
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
