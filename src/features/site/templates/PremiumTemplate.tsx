import { ProfessionalPhoto } from "@/features/catalog/components/ProfessionalPhoto"
import { formatPrice } from "@/features/catalog/domain"
import { cn } from "@/lib/utils"
import { Heading, ContactLines, CoverImage, GalleryPhoto, ReserveButton, SECTION, ServiceNameButton, ShopMark, telHref } from "./shared"
import type { TemplateProps } from "./types"

const SERIF = "font-[family-name:var(--font-premium)]"

const Title = ({ id, children, note }: { id: string; children: React.ReactNode; note?: string }) => (
  <div className="flex flex-col gap-3">
    <span aria-hidden="true" className="h-px w-14 bg-primary" />
    <h2 id={id} className={`${SERIF} text-4xl leading-none font-medium @3xl:text-6xl`}>{children}</h2>
    {note && <p className="max-w-[48ch] text-sm text-muted-foreground">{note}</p>}
  </div>
)

/** Premium: editorial. Cabeçalho em três partes, retrato alto ao lado de um título enorme, serviços numerados em lista e equipe/galeria escalonadas. */
export function PremiumTemplate({ view, onReserve, onOpenService, headingLevel = 1 }: TemplateProps) {
  const tel = telHref(view.telefone)
  return (
    <div className="bg-background text-foreground">
      <header className="mx-auto grid w-[min(100%-2rem,1200px)] grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-border py-5">
        <nav aria-label="Seções do site" className="hidden gap-6 text-xs tracking-[0.2em] uppercase @3xl:flex">
          {view.services.length > 0 && <a href={`#${SECTION.servicos}`} className="underline-offset-8 hover:underline decoration-primary">Serviços</a>}
          {view.professionals.length > 0 && <a href={`#${SECTION.equipe}`} className="underline-offset-8 hover:underline decoration-primary">Equipe</a>}
          {view.galeriaUrls.length > 0 && <a href={`#${SECTION.galeria}`} className="underline-offset-8 hover:underline decoration-primary">Galeria</a>}
        </nav>
        <div className="col-start-2 flex items-center justify-center gap-3 @3xl:col-auto">
          <ShopMark view={view} className="h-9 w-9 shrink-0 rounded-full text-base" />
          <span className={`${SERIF} text-2xl font-medium tracking-wide`}>{view.nome}</span>
        </div>
        <div className="col-start-3 flex justify-end text-xs tracking-[0.2em] uppercase">
          <a href={`#${SECTION.contato}`} className="underline-offset-8 hover:underline decoration-primary">Contato</a>
        </div>
      </header>

      <div className="mx-auto flex w-[min(100%-2rem,1200px)] flex-col gap-24 pt-12 pb-20 @3xl:pt-20">
        <section className="grid items-end gap-10 @3xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] @3xl:gap-16">
          <CoverImage view={view} className="aspect-[4/5] w-full @3xl:aspect-[3/4]" />
          <div className="flex flex-col gap-7 @3xl:pb-6">
            <Heading level={headingLevel} className={`${SERIF} text-6xl leading-[0.95] font-medium @3xl:text-8xl`}>{view.nome}</Heading>
            <span aria-hidden="true" className="h-px w-24 bg-primary" />
            {view.descricao && <p className={`${SERIF} max-w-[40ch] text-2xl leading-snug text-foreground/85 @3xl:text-3xl`}>{view.descricao}</p>}
            {view.services.length > 0 && (
              <a href={`#${SECTION.servicos}`} className="w-fit border-b border-primary pb-1 text-sm tracking-[0.2em] uppercase transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Agendar horário</a>
            )}
          </div>
        </section>

        {view.services.length > 0 && (
          <section aria-labelledby={SECTION.servicos} id={SECTION.servicos} className="flex scroll-mt-4 flex-col gap-10">
            <Title id={SECTION.servicos} note="Escolha um serviço e reserve o profissional, o dia e o horário.">Serviços</Title>
            <ul aria-label="Serviços" className="flex flex-col border-t border-border">
              {view.services.map((item, i) => (
                <li key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-5 gap-y-3 border-b border-border py-7 @3xl:grid-cols-[72px_minmax(0,1fr)_auto_auto] @3xl:items-center @3xl:gap-x-8">
                  <span aria-hidden="true" className={`${SERIF} text-3xl text-primary tabular-nums @3xl:text-4xl`}>{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0">
                    <ServiceNameButton service={item} onOpen={onOpenService} className={`${SERIF} text-3xl leading-tight font-medium hover:underline @3xl:text-4xl`} />
                    <p className="mt-1 text-sm text-muted-foreground">{item.duracao_min} min{item.descricao ? ` · ${item.descricao}` : ""}</p>
                  </div>
                  <span className={`${SERIF} col-start-2 text-3xl font-medium tabular-nums @3xl:col-start-auto`}>{formatPrice(item.preco_centavos)}</span>
                  <ReserveButton service={item} onReserve={onReserve} className="col-start-2 w-fit rounded-none @3xl:col-start-auto">Reservar</ReserveButton>
                </li>
              ))}
            </ul>
          </section>
        )}

        {view.professionals.length > 0 && (
          <section aria-labelledby="equipe-titulo" id={SECTION.equipe} className="flex scroll-mt-4 flex-col gap-10">
            <Title id="equipe-titulo">Profissionais</Title>
            <ul className="grid grid-cols-2 gap-x-5 gap-y-10 @3xl:grid-cols-4">
              {view.professionals.map((p, i) => (
                <li key={p.id} className={cn("flex flex-col gap-3", i % 2 === 1 && "@3xl:translate-y-10")}>
                  <ProfessionalPhoto nome={p.nome} path={p.avatar_path} className={`${SERIF} aspect-[3/4] w-full rounded-none text-7xl`} />
                  <span className={`${SERIF} text-2xl italic`}>{p.nome}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {view.galeriaUrls.length > 0 && (
          <section aria-labelledby={SECTION.galeria} id={SECTION.galeria} className="flex scroll-mt-4 flex-col gap-10 @3xl:pt-8">
            <Title id={SECTION.galeria}>Galeria</Title>
            <ul className="columns-2 gap-4 @3xl:columns-3 @3xl:gap-6">
              {view.galeriaUrls.map((url, i) => (
                <li key={`${url}-${i}`} className="mb-4 break-inside-avoid @3xl:mb-6">
                  <GalleryPhoto url={url} index={i} nome={view.nome} className={i % 3 === 0 ? "aspect-[3/4]" : i % 3 === 1 ? "aspect-square" : "aspect-[4/5]"} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="contato-titulo" id={SECTION.contato} className="flex scroll-mt-4 flex-col gap-8 border border-primary/50 p-8 @3xl:flex-row @3xl:items-end @3xl:justify-between @3xl:p-14">
          <div className="flex flex-col gap-6">
            <Title id="contato-titulo">Contato</Title>
            <ContactLines view={view} className={`${SERIF} text-2xl`} iconClassName="text-primary" />
          </div>
          {view.services.length > 0 && <a href={`#${SECTION.servicos}`} className="inline-flex h-12 items-center justify-center bg-primary px-8 text-sm font-semibold tracking-[0.18em] text-primary-foreground uppercase transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">Agendar horário</a>}
          {!view.services.length && tel && <a href={tel} className="underline">Ligar</a>}
        </section>
      </div>
    </div>
  )
}
