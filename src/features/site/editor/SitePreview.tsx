import { useState } from "react"
import { Eye, Monitor, Smartphone, Tablet, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { SiteRenderer, TEMPLATE_INFO, type SiteView, type TemplateId } from "../templates"
import { ScaledFrame } from "./ScaledFrame"

const noop = () => {}
type Device = "desktop" | "tablet" | "celular"
const DEVICES: { id: Device; label: string; icon: LucideIcon; width: number; height: number }[] = [
  { id: "desktop", label: "Computador", icon: Monitor, width: 1280, height: 760 },
  { id: "tablet", label: "Tablet", icon: Tablet, width: 768, height: 820 },
  { id: "celular", label: "Celular", icon: Smartphone, width: 390, height: 780 },
]

/** Pré-visualização grande: o MESMO modelo da página publicada, com os dados reais, na largura de computador, tablet ou celular. */
export function SitePreview({ view, accent, template, unsaved }: { view: SiteView; accent: string | null; template: TemplateId; unsaved: boolean }) {
  const [device, setDevice] = useState<Device>("desktop")
  const current = DEVICES.find((d) => d.id === device)!
  return (
    <section aria-labelledby="previa-titulo" className="flex min-h-[560px] flex-1 flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Eye aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />
          <h2 id="previa-titulo" className="font-display text-lg font-bold tracking-wide">Pré-visualização — Template {TEMPLATE_INFO[template].nome}</h2>
          {unsaved && <span className="rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">Rascunho, ainda não publicado</span>}
        </div>
        <div role="group" aria-label="Tamanho da tela" className="flex gap-1 rounded-lg border border-border bg-surface-alt p-1">
          {DEVICES.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-label={label} title={label} aria-pressed={device === id} onClick={() => setDevice(id)}
              className={cn("grid h-9 w-11 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", device === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              <Icon aria-hidden="true" className="h-4 w-4" />
            </button>
          ))}
        </div>
      </header>
      <div className="relative min-h-[460px] flex-1 overflow-hidden rounded-xl border border-border bg-background">
        <div className="absolute inset-2 sm:inset-3">
        <ScaledFrame key={device} width={current.width} height={current.height} fill scroll label={`Pré-visualização do site no ${current.label.toLowerCase()}`}>
          <SiteRenderer template={template} view={view} accent={accent} onReserve={noop} onOpenService={noop} headingLevel={2} />
        </ScaledFrame>
        </div>
      </div>
      <p className="text-[13px] text-muted-foreground">Role dentro da moldura para ver o site inteiro. Os botões da prévia não fazem reservas. Endereço e telefone vêm de “Mais”; a prévia usa os serviços e profissionais ativos de hoje.</p>
    </section>
  )
}
