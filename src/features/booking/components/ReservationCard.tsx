import type { ReactNode } from "react"
import { ProfessionalPhoto } from "@/features/catalog/components/ProfessionalPhoto"
import { cn } from "@/lib/utils"

/**
 * Card de reserva, único para a área do cliente (/minhas-reservas) e para a agenda da equipe (/agendamentos):
 * foto QUADRADA do profissional rente às bordas de cima, de baixo e da esquerda, dados no meio e ações à direita
 * (embaixo no celular). `photo` troca a foto (ex.: cadeado de um bloqueio).
 */
export function ReservationCard({ professional, photo, children, actions, muted = false }: {
  professional?: { nome: string; avatar_path?: string | null } | null
  photo?: ReactNode
  children: ReactNode
  actions?: ReactNode
  muted?: boolean
}) {
  return (
    <li className={cn("flex min-h-24 overflow-hidden rounded-card border border-border bg-card text-left shadow-sm", muted && "bg-card/60")}>
      <div className="w-24 shrink-0 self-stretch bg-surface-alt sm:w-32">
        {photo ?? <ProfessionalPhoto nome={professional?.nome ?? "?"} path={professional?.avatar_path} className="aspect-square w-full rounded-none text-3xl" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-3 p-3 sm:flex-row sm:items-center sm:p-4">
        <div className="min-w-0 flex-1">{children}</div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </li>
  )
}
