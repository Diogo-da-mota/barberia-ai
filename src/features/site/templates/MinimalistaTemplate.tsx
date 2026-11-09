import { ArrowRight } from "lucide-react"
import { ProfessionalPhoto } from "@/features/catalog/components/ProfessionalPhoto"
import { formatPrice } from "@/features/catalog/domain"
import { Heading, ContactLines, CoverImage, GalleryPhoto, ReserveButton, SECTION, ServiceNameButton, ShopMark, prettyPhone, telHref } from "./shared"
import type { TemplateProps } from "./types"

const Title = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <h2 id={id} className="text-sm font-medium tracking-[0.16em] text-muted-foreground uppercase">{children}</h2>
)

/** Minimalista: branco, muito ar, tipografia leve. Serviços em linhas de tabela, equipe em lista e galeria sem molduras. */
export function MinimalistaTemplate({ view, onReserve, onOpenService, headingLevel = 1 }: TemplateProps) {
  const tel = telHref(view.telefone)
  return (
    <div className="bg-background text-foreground">
      <header className="mx-auto flex w-[min(100%-2rem,1080px)] items-center justify-between gap-4 border-b border-border py-5">
        <div className="flex min-w-0 items-center gap-3">
          <ShopMark view={view} className="h-8 w-8 shrink-0 rounded-md text-sm" />
          <span className="truncate text-base font-semibold">{view.nome}</span>
        </div>
        <nav aria-label="Seções do site" className="hidden gap-7 text-sm text-muted-foreground @3xl:flex">
          {view.services.length > 0 && <a href={`#${SECTION.servicos}`} className="transition-colors hover:text-foreground">Serviços</a>}
          {view.professionals.length > 0 && <a href={`#${SECTION.equipe}`} className="transition-colors hover:text-foreground">Equipe</a>}
          {view.galeriaUrls.length > 0 && <a href={`#${SECTION.galeria}`} className="transition-colors hover:text-foreground">Galeria</a>}
          <a href={`#${SECTION.contato}`} className="transition-colors hover:text-foreground">Contato</a>
        </nav>
      </header>

      <div className="mx-auto flex w-[min(100%-2rem,1080px)] flex-col gap-20 pt-14 pb-20 @3xl:pt-20">
        <section className="flex flex-col gap-10">
          <div className="flex flex-col gap-6">
            <Heading level={headingLevel} className="max-w-[16ch] text-5xl leading-[1.02] font-light tracking-tight @3xl:text-7xl">{view.nome}</Heading>
            {view.descricao && <p className="max-w-[54ch] text-lg leading-relaxed text-muted-foreground">{view.descricao}</p>}
            {view.services.length > 0 && (
              <a href={`#${SECTION.servicos}`} className="group inline-flex w-fit items-center gap-2 border-b-2 border-primary pb-1 text-base font-semibold">
                Agendar horário<ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </a>
            )}
          </div>
          <CoverImage view={view} className="aspect-[16/9] w-full rounded-2xl @3xl:aspect-[21/9]" />
        </section>

        {view.services.length > 0 && (
          <section aria-labelledby={SECTION.servicos} id={SECTION.servicos} className="flex scroll-mt-4 flex-col gap-6">
            <Title id={SECTION.servicos}>Serviços</Title>
            <ul aria-label="Serviços" className="flex flex-col divide-y divide-border border-y border-border">
              {view.services.map((item) => (
                <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-3 py-5 @3xl:grid-cols-[minmax(0,1fr)_90px_100px_auto]">
                  <div className="min-w-0">
                    <ServiceNameButton service={item} onOpen={onOpenService} className="text-lg font-medium hover:underline" />
                    {item.descricao && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.descricao}</p>}
                  </div>
                  <span className="hidden text-sm text-muted-foreground tabular-nums @3xl:block">{item.duracao_min} min</span>
                  <span className="text-right text-lg font-medium tabular-nums @3xl:text-left">{formatPrice(item.preco_centavos)}</span>
                  <ReserveButton service={item} onReserve={onReserve} className="col-span-2 bg-foreground text-background @3xl:col-span-1" />
                </li>
              ))}
            </ul>
          </section>
        )}

        {view.professionals.length > 0 && (
          <section aria-labelledby="equipe-titulo" id={SECTION.equipe} className="flex scroll-mt-4 flex-col gap-6">
            <Title id="equipe-titulo">Profissionais</Title>
            <ul className="grid gap-x-8 gap-y-5 @3xl:grid-cols-3">
              {view.professionals.map((p) => (
                <li key={p.id} className="flex items-center gap-4">
                  <ProfessionalPhoto nome={p.nome} path={p.avatar_path} className="h-14 w-14 rounded-full text-xl" />
                  <span className="text-lg font-medium">{p.nome}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {view.galeriaUrls.length > 0 && (
          <section aria-labelledby={SECTION.galeria} id={SECTION.galeria} className="flex scroll-mt-4 flex-col gap-6">
            <Title id={SECTION.galeria}>Galeria</Title>
            <ul className="grid grid-cols-2 gap-3 @3xl:grid-cols-3 @3xl:gap-5">
              {view.galeriaUrls.map((url, i) => <li key={`${url}-${i}`}><GalleryPhoto url={url} index={i} nome={view.nome} className="aspect-[4/3] rounded-xl" /></li>)}
            </ul>
          </section>
        )}

        <section aria-labelledby="contato-titulo" id={SECTION.contato} className="grid scroll-mt-4 gap-6 border-t border-border pt-10 @3xl:grid-cols-[1fr_2fr]">
          <Title id="contato-titulo">Contato</Title>
          <div className="flex flex-col gap-3">
            <ContactLines view={view} className="text-lg" />
            {tel && <p className="text-sm text-muted-foreground">Ligue para {prettyPhone(view.telefone)} ou reserve online acima.</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
