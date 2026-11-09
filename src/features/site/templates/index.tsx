import type { ComponentType, MouseEvent } from "react"
import { isShopSection } from "@/lib/shopPaths"
import { accentStyle } from "../domain"
import { ClassicoTemplate } from "./ClassicoTemplate"
import { MinimalistaTemplate } from "./MinimalistaTemplate"
import { ModernoTemplate } from "./ModernoTemplate"
import { paletteStyle } from "./palette"
import { PremiumTemplate } from "./PremiumTemplate"
import { UrbanoTemplate } from "./UrbanoTemplate"
import { DEFAULT_TEMPLATE, isTemplateId, type TemplateId, type TemplateProps } from "./types"

const COMPONENTS: Record<TemplateId, ComponentType<TemplateProps>> = {
  urbano: UrbanoTemplate, classico: ClassicoTemplate, minimalista: MinimalistaTemplate, moderno: ModernoTemplate, premium: PremiumTemplate,
}

/**
 * Os links de seção dos modelos são âncoras (#servicos): funcionam sem JavaScript e na prévia. Na página publicada (`basePath`),
 * o clique rola até a seção e a barra de endereços mostra a URL limpa (/slug/servicos), sem `#`.
 */
function followSectionLink(event: MouseEvent<HTMLElement>, basePath: string) {
  const href = (event.target as HTMLElement).closest("a")?.getAttribute("href")
  if (!href?.startsWith("#") || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
  const id = href.slice(1)
  if (id !== "inicio" && !isShopSection(id)) return // só as seções com endereço próprio ganham URL limpa
  const target = document.getElementById(id)
  if (!target) return
  event.preventDefault()
  target.scrollIntoView({ behavior: "smooth" })
  window.history.replaceState(window.history.state, "", id === "inicio" ? basePath : `${basePath}/${id}`)
}

/**
 * Raiz de um modelo de site. É um `@container`: os modelos respondem à LARGURA DESTE ELEMENTO (não da janela), então o mesmo código serve
 * à página publicada (largura da tela) e à pré-visualização do painel (moldura de desktop, tablet ou celular).
 */
export function SiteRenderer({ template, accent, basePath, ...props }: TemplateProps & { template: TemplateId | string | null | undefined; accent?: string | null; basePath?: string }) {
  const id = isTemplateId(template) ? template : DEFAULT_TEMPLATE
  const Template = COMPONENTS[id]
  return (
    <div data-template={id} className="@container bg-background font-body text-foreground" style={{ ...paletteStyle(id), ...accentStyle(accent) }} onClick={basePath ? (event) => followSectionLink(event, basePath) : undefined}>
      <Template {...props} />
    </div>
  )
}

export { DEFAULT_TEMPLATE, TEMPLATE_IDS, TEMPLATE_INFO, isTemplateId, type SiteView, type SiteViewService, type TemplateId } from "./types"
