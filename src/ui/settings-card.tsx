import type { ReactNode } from "react"
import { Info, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** Cartão compacto das telas administrativas (Mais e Central de mensagens): ícone, título e explicação em cima, uma linha fina e o conteúdo. */
export function SettingsCard({ icon: Icon, title, hint, action, children, className }: { icon: LucideIcon; title: string; hint?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  const id = `card-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col rounded-card border border-border bg-card", className)}>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-foreground/80" />
          <div className="min-w-0">
            <h2 id={id} className="font-display text-base leading-tight font-bold tracking-wide">{title}</h2>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
        </div>
        {action}
      </header>
      <div className="flex min-w-0 flex-1 flex-col gap-3 px-4 py-4 sm:px-5">{children}</div>
    </section>
  )
}

/** Aviso de recurso que depende de uma alteração no banco ainda não aplicada: nada aqui finge que funciona. */
export function PendingNotice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-warning">
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

export const FIELD = "h-11 text-base md:h-10 md:text-sm"
