import type { ReactNode } from "react"
import { User } from "lucide-react"
import { publicMediaUrl } from "@/features/site/api"
import { cn } from "@/lib/utils"

/** Foto do profissional em quadrado de cantos arredondados (a inicial do nome quando não há foto). Um só visual em todo o sistema. */
export function ProfessionalPhoto({ nome, path, className, fallback, flush = false }: { nome: string; path?: string | null; className?: string; fallback?: ReactNode; flush?: boolean }) {
  const url = publicMediaUrl(path)
  return (
    <span aria-hidden="true" data-testid="professional-photo" className={cn("flex shrink-0 items-center justify-center overflow-hidden bg-primary/15 font-display font-bold text-primary", flush ? "self-stretch rounded-none" : "rounded-md", className)}>
      {url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" /> : fallback ?? (nome.trim() ? nome.trim().charAt(0).toUpperCase() : <User className="h-1/2 w-1/2" />)}
    </span>
  )
}

/** Foto pequena + nome, para linhas de lista (agenda, financeiro, reservas). */
export function ProfessionalTag({ nome, path, className }: { nome: string; path?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 align-middle", className)}>
      <ProfessionalPhoto nome={nome} path={path} className="h-6 w-6 rounded-l-md rounded-r-none text-[11px]" />
      <span className="truncate">{nome}</span>
    </span>
  )
}
