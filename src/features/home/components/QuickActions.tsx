import { Link } from "react-router-dom"
import { CalendarCheck, Link2, Scissors, Users, Zap, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { shopPath } from "@/lib/shopPaths"

type Action = { label: string; hint: string; icon: LucideIcon; to: string; external?: boolean }

/** Menu de atalhos para telas que existem. Nada de ação inventada: cada item leva a um lugar onde a ação já funciona. */
export function QuickActions({ manager, siteSlug }: { manager: boolean; siteSlug: string | null }) {
  const actions: Action[] = [
    { label: "Ver agenda", hint: "Atendimentos do dia", icon: CalendarCheck, to: "/dashboard/agendamentos" },
    ...(manager ? [
      { label: "Novo serviço", hint: "Cadastrar serviço", icon: Scissors, to: "/dashboard/servicos" },
      { label: "Equipe", hint: "Gerenciar profissionais", icon: Users, to: "/dashboard/equipe" },
    ] : []),
    ...(siteSlug ? [{ label: "Ver meu site", hint: "Acessar página pública", icon: Link2, to: shopPath(siteSlug), external: true }] : []),
  ]
  return (
    <nav aria-label="Ações rápidas" className="flex flex-wrap items-center gap-2">
      <span className="mr-1 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground"><Zap className="h-4 w-4 text-primary" aria-hidden="true" />Ações rápidas</span>
      {actions.map(({ label, hint, icon: Icon, to, external }, index) => (
        <Link
          key={label}
          to={to}
          title={hint}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            index === 0 ? "border-primary/70 bg-primary/10 hover:bg-primary/15" : "border-border bg-card hover:bg-foreground/5",
          )}
        >
          <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  )
}
