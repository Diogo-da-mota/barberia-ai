import type { ReactNode } from "react"
import { MapPin, Phone, Scissors } from "lucide-react"
import { formatDuration, formatPrice } from "@/features/catalog/domain"
import { formatPhone, phoneDigits } from "@/lib/br"
import { cn } from "@/lib/utils"
import type { SiteView, SiteViewService } from "./types"

/** Âncoras de seção usadas por todos os modelos (a página rola até elas; na prévia ficam inertes). */
export const SECTION = { servicos: "servicos", equipe: "profissionais", galeria: "galeria", contato: "contato" } as const

export const telHref = (telefone: string | null) => {
  const digits = telefone?.replace(/\D/g, "") ?? ""
  return digits ? `tel:+55${phoneDigits(digits)}` : null
}
export const prettyPhone = (telefone: string | null) => (telefone ? formatPhone(telefone) : "")

/** Logo da barbearia; sem logo, a inicial do nome na cor de destaque. */
export function ShopMark({ view, className, textClassName }: { view: SiteView; className?: string; textClassName?: string }) {
  return view.logoUrl ? (
    <img src={view.logoUrl} alt={`Logo de ${view.nome}`} className={cn("object-cover", className)} />
  ) : (
    <span data-testid="site-logo-fallback" aria-hidden="true" className={cn("flex items-center justify-center bg-primary font-display font-bold text-primary-foreground", className, textClassName)}>
      {view.nome.trim().charAt(0).toUpperCase()}
    </span>
  )
}

export function CoverImage({ view, className }: { view: SiteView; className?: string }) {
  return view.capaUrl ? <img src={view.capaUrl} alt={`Capa de ${view.nome}`} className={cn("object-cover", className)} /> : (
    <div aria-hidden="true" className={cn("bg-gradient-to-br from-primary/35 via-primary/10 to-surface-alt", className)} />
  )
}

export function GalleryPhoto({ url, index, nome, className }: { url: string; index: number; nome: string; className?: string }) {
  return <img src={url} alt={`Foto ${index + 1} de ${nome}`} loading="lazy" className={cn("h-full w-full object-cover", className)} />
}

/** Botão Reservar de um serviço: nome acessível igual em todos os modelos. */
export function ReserveButton({ service, onReserve, className, children = "Reservar" }: { service: SiteViewService; onReserve: (id: string) => void; className?: string; children?: ReactNode }) {
  return (
    <button type="button" aria-label={`Reservar ${service.nome}`} onClick={() => onReserve(service.id)}
      className={cn("inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background", className)}>
      {children}
    </button>
  )
}

/** Nome do serviço que abre os detalhes (botão, para funcionar com teclado). */
export function ServiceNameButton({ service, onOpen, className }: { service: SiteViewService; onOpen: (id: string) => void; className?: string }) {
  return <button type="button" onClick={() => onOpen(service.id)} className={cn("text-left focus-visible:outline-none focus-visible:underline", className)}>{service.nome}</button>
}

export const serviceMeta = (s: SiteViewService) => `${formatDuration(s.duracao_min)} · ${formatPrice(s.preco_centavos)}`

export function ScissorsFallback({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex items-center justify-center bg-gradient-to-br from-primary/25 via-primary/10 to-surface-alt text-primary", className)}>
      <Scissors className="h-10 w-10 opacity-80" />
    </div>
  )
}

export function ContactLines({ view, className, iconClassName }: { view: SiteView; className?: string; iconClassName?: string }) {
  const tel = telHref(view.telefone)
  if (!view.endereco && !tel) return null
  return (
    <ul className={cn("flex flex-col gap-2 text-base", className)}>
      {view.endereco && <li className="flex items-start gap-3"><MapPin aria-hidden="true" className={cn("mt-1 h-4 w-4 shrink-0", iconClassName)} /><span>{view.endereco}</span></li>}
      {tel && <li className="flex items-center gap-3"><Phone aria-hidden="true" className={cn("h-4 w-4 shrink-0", iconClassName)} /><a href={tel} className="underline-offset-4 hover:underline">{prettyPhone(view.telefone)}</a></li>}
    </ul>
  )
}

/** Botão-âncora (Agendar horário / Ligar) com o mesmo comportamento em todos os modelos. */
export function LinkButton({ href, variant = "primary", className, children }: { href: string; variant?: "primary" | "outline"; className?: string; children: ReactNode }) {
  return (
    <a href={href} className={cn(
      "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-5 text-sm font-semibold transition-[filter,transform,background-color] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      variant === "primary" ? "bg-primary text-primary-foreground hover:brightness-110" : "border border-border bg-card/60 text-foreground hover:bg-surface-alt",
      className,
    )}>{children}</a>
  )
}

export function Heading({ level, className, children }: { level: 1 | 2; className?: string; children: ReactNode }) {
  const Tag = level === 1 ? "h1" : "h2"
  return <Tag className={className}>{children}</Tag>
}
