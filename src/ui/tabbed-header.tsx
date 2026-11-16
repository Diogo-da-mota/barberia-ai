import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { TabsList, TabsTrigger } from "@/ui/tabs"

const PHOTO = "/images/painel-topo.jpg"
const MASK = "linear-gradient(to right, transparent, black 55%)"

/**
 * Camada da foto do cabeçalho com abas (só no tema escuro), a MESMA na página e na prévia de Meu site › Fotos. `src`: undefined =
 * carregando (sem piscar a padrão), null = foto padrão. `phone` fixa as medidas do celular (a prévia roda numa tela de computador).
 */
export function TabbedHeaderPhoto({ src, phone = false }: { src: string | null | undefined; phone?: boolean }) {
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-x-0 top-0 -z-10 hidden max-h-[110px] min-h-0 overflow-hidden [.dark_&]:block [.dark_&]:h-full", !phone && "sm:max-h-[130px] lg:max-h-[160px]")}>
      {src !== undefined && (
        <img
          src={src ?? PHOTO} alt="" decoding="async" style={{ maskImage: MASK, WebkitMaskImage: MASK }}
          className={cn("absolute inset-y-0 right-0 h-full w-full object-cover object-[60%_62%] opacity-45", !phone && "sm:w-[78%] sm:opacity-80 lg:w-[66%]")}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-background/5" />
    </div>
  )
}

/**
 * Cabeçalho das telas de gestão com abas: ícone, título e descrição à esquerda, fotografia de barbearia discreta à direita (só no tema
 * escuro; no máximo 110/130/160px de altura, esmaecida por degradês) e, logo abaixo, as abas com um espaço opcional à direita (ex.: o mês).
 * Precisa estar dentro de um `<Tabs>` quando `tabs` é informado. Sem `tabs`, é só o título.
 */
export function TabbedHeader({ name, icon: Icon, title, description, tabs, right, photo = true }: {
  /** Vira `data-banner`, para identificar a tela. */
  name: string
  icon: LucideIcon
  title: string
  description: string
  tabs?: readonly { value: string; label: string }[]
  right?: ReactNode
  /** Com foto (padrão), com a foto da barbearia (`{ src }`) ou compacto (`false`): sem fotografia, ícone menor e título e abas na mesma linha. */
  photo?: boolean | { src: string | null | undefined }
}) {
  if (photo === false) {
    return (
      <header data-banner={name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary"><Icon className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h1 className="font-display text-xl leading-tight font-bold tracking-wide sm:text-2xl">{title}</h1>
            <p className="text-[13px] text-muted-foreground">{description}</p>
          </div>
        </div>
        {(tabs || right) && (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
            {tabs && (
              <TabsList className="h-auto max-w-full justify-start gap-1 overflow-x-auto border border-border bg-card">
                {tabs.map((t) => <TabsTrigger key={t.value} value={t.value} className="shrink-0 px-3 sm:px-4">{t.label}</TabsTrigger>)}
              </TabsList>
            )}
            {right}
          </div>
        )}
      </header>
    )
  }
  return (
    <header data-banner={name} className="relative isolate flex flex-col gap-4">
      <TabbedHeaderPhoto src={typeof photo === "object" ? photo.src : null} />

      <div className="flex items-center gap-4 pt-1">
        <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 text-primary sm:h-16 sm:w-16"><Icon className="h-7 w-7" /></span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-wide sm:text-[28px]">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>

      {tabs && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <TabsList className="h-auto max-w-full justify-start gap-1 overflow-x-auto border border-border bg-card/90 backdrop-blur-sm">
            {tabs.map((t) => <TabsTrigger key={t.value} value={t.value} className="shrink-0 px-3 sm:px-5">{t.label}</TabsTrigger>)}
          </TabsList>
          {right}
        </div>
      )}
    </header>
  )
}
