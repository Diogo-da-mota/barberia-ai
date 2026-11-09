import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { SiteRenderer, TEMPLATE_IDS, TEMPLATE_INFO, type SiteView, type TemplateId } from "../templates"
import { ScaledFrame } from "./ScaledFrame"

const noop = () => {}

/** Galeria horizontal de modelos. Cada miniatura é o modelo de verdade, renderizado com os dados reais da barbearia e reduzido. */
export function TemplateGallery({ view, accent, selected, saved, onSelect }: { view: SiteView; accent: string | null; selected: TemplateId; saved: TemplateId; onSelect: (id: TemplateId) => void }) {
  return (
    <div role="radiogroup" aria-label="Template do site" className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 xl:grid xl:grid-cols-5 xl:overflow-visible">
      {TEMPLATE_IDS.map((id) => {
        const on = id === selected
        return (
          // div com role=radio (e não button): a miniatura é um site inteiro, com botões dentro, e botão dentro de botão é HTML inválido
          <div
            key={id} role="radio" tabIndex={0} aria-checked={on} aria-label={TEMPLATE_INFO[id].nome} onClick={() => onSelect(id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(id) } }}
            className={cn(
              "flex w-52 cursor-pointer shrink-0 snap-start flex-col gap-3 rounded-card border bg-card p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary xl:w-auto",
              on ? "border-primary bg-primary/[0.06]" : "border-border hover:border-foreground/30",
            )}
          >
            <span className="relative block overflow-hidden rounded-lg border border-border">
              <ScaledFrame width={1280} height={720}>
                <SiteRenderer template={id} view={view} accent={accent} onReserve={noop} onOpenService={noop} headingLevel={2} />
              </ScaledFrame>
              {on && <span aria-hidden="true" className="absolute top-2 right-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="h-4 w-4" /></span>}
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-display text-lg leading-none font-bold tracking-wide">{TEMPLATE_INFO[id].nome}</span>
                {id === saved && <span className="rounded-md border border-border bg-surface-alt px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">Publicado</span>}
              </span>
              <span className="text-[13px] leading-snug text-muted-foreground">{TEMPLATE_INFO[id].resumo}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
