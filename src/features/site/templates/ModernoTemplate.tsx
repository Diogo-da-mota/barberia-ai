import { ArrowUpRight, MapPin, Phone } from "lucide-react"
import { ProfessionalPhoto } from "@/features/catalog/components/ProfessionalPhoto"
import { formatPrice } from "@/features/catalog/domain"
import { Heading, CoverImage, GalleryPhoto, LinkButton, ReserveButton, SECTION, ScissorsFallback, ServiceNameButton, ShopMark, prettyPhone, telHref } from "./shared"
import type { TemplateProps } from "./types"

const Title = ({ id, children, count }: { id: string; children: React.ReactNode; count?: number }) => (
  <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
    <h2 id={id} className="font-display text-4xl leading-none font-extrabold tracking-wide uppercase @3xl:text-6xl">{children}</h2>
    {count !== undefined && <span aria-hidden="true" className="font-display text-xl text-muted-foreground tabular-nums">{String(count).padStart(2, "0")}</span>}
  </div>
)

/** Moderno: a fotografia ocupa a primeira tela inteira com o nome gigante sobre ela; serviços como cartazes verticais e galeria em mosaico. */
export function ModernoTemplate({ view, onReserve, onOpenService, headingLevel = 1 }: TemplateProps) {
  const tel = telHref(view.telefone)
  const mosaic = ["col-span-2 row-span-2", "", "", "col-span-2", "", ""]
  return (
    <div className="bg-background text-foreground">
      <section className="relative isolate flex min-h-[520px] flex-col justify-between overflow-hidden @3xl:min-h-[680px]">
        <CoverImage view={view} className="absolute inset-0 -z-10 h-full w-full" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-background via-background/55 to-background/25" />
        <header className="mx-auto flex w-[min(100%-2rem,1240px)] items-center justify-between gap-3 pt-5">
          <div className="flex min-w-0 items-center gap-3 rounded-full bg-background/75 py-1.5 pr-5 pl-1.5">
            <ShopMark view={view} className="h-9 w-9 shrink-0 rounded-full text-base" />
            <span className="truncate text-sm font-semibold tracking-wide uppercase">{view.nome}</span>
          </div>
          <nav aria-label="Seções do site" className="hidden gap-1 rounded-full bg-background/75 p-1.5 text-sm @3xl:flex">
            {view.services.length > 0 && <a href={`#${SECTION.servicos}`} className="rounded-full px-4 py-1.5 transition-colors hover:bg-surface-alt">Serviços</a>}
            {view.professionals.length > 0 && <a href={`#${SECTION.equipe}`} className="rounded-full px-4 py-1.5 transition-colors hover:bg-surface-alt">Time</a>}
            {view.galeriaUrls.length > 0 && <a href={`#${SECTION.galeria}`} className="rounded-full px-4 py-1.5 transition-colors hover:bg-surface-alt">Galeria</a>}
            <a href={`#${SECTION.contato}`} className="rounded-full px-4 py-1.5 transition-colors hover:bg-surface-alt">Contato</a>
          </nav>
        </header>
        <div className="mx-auto flex w-[min(100%-2rem,1240px)] flex-col gap-6 pb-10 @3xl:pb-14">
          <Heading level={headingLevel} className="max-w-[12ch] font-display text-6xl leading-[0.88] font-extrabold tracking-tight uppercase @3xl:text-8xl @5xl:text-9xl">{view.nome}</Heading>
          <div className="flex flex-col gap-5 @3xl:flex-row @3xl:items-end @3xl:justify-between">
            {view.descricao && <p className="max-w-[44ch] text-lg text-foreground/85">{view.descricao}</p>}
            <div className="flex flex-wrap gap-3">
              {view.services.length > 0 && <LinkButton href={`#${SECTION.servicos}`} className="h-12 rounded-full px-7 text-base">Agendar horário<ArrowUpRight aria-hidden="true" className="h-4 w-4" /></LinkButton>}
              {tel && <LinkButton href={tel} variant="outline" className="h-12 rounded-full bg-background/75 px-6"><Phone aria-hidden="true" className="h-4 w-4" />{prettyPhone(view.telefone)}</LinkButton>}
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto flex w-[min(100%-2rem,1240px)] flex-col gap-20 py-16">
        {view.services.length > 0 && (
          <section aria-labelledby={SECTION.servicos} id={SECTION.servicos} className="flex scroll-mt-4 flex-col gap-8">
            <Title id={SECTION.servicos} count={view.services.length}>Serviços</Title>
            <ul aria-label="Serviços" className="grid gap-4 @xl:grid-cols-2 @5xl:grid-cols-3">
              {view.services.map((item) => (
                <li key={item.id} className="group relative isolate flex min-h-[380px] flex-col justify-end overflow-hidden rounded-2xl border border-border">
                  {item.photos[0] ? <img src={item.photos[0]} alt={`Fotos de ${item.nome}`} loading="lazy" className="absolute inset-0 -z-10 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" /> : <ScissorsFallback className="absolute inset-0 -z-10" />}
                  <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-background via-background/70 to-transparent" />
                  <div className="flex flex-col gap-3 p-5">
                    <ServiceNameButton service={item} onOpen={onOpenService} className="font-display text-3xl leading-none font-bold tracking-wide uppercase hover:underline" />
                    {item.descricao && <p className="line-clamp-2 text-sm text-foreground/80">{item.descricao}</p>}
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-display text-2xl font-bold tabular-nums">{formatPrice(item.preco_centavos)}<span className="ml-2 font-body text-sm font-normal text-muted-foreground">{item.duracao_min} min</span></span>
                      <ReserveButton service={item} onReserve={onReserve} className="rounded-full" />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {view.professionals.length > 0 && (
          <section aria-labelledby="equipe-titulo" id={SECTION.equipe} className="flex scroll-mt-4 flex-col gap-8">
            <Title id="equipe-titulo" count={view.professionals.length}>Profissionais</Title>
            <ul className="grid grid-cols-2 gap-4 @3xl:grid-cols-4">
              {view.professionals.map((p) => (
                <li key={p.id} className="relative isolate aspect-[3/4] overflow-hidden rounded-2xl border border-border">
                  <ProfessionalPhoto nome={p.nome} path={p.avatar_path} className="absolute inset-0 -z-10 h-full w-full rounded-none text-7xl" />
                  <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-gradient-to-t from-background to-transparent" />
                  <span className="absolute bottom-4 left-4 font-display text-2xl font-bold tracking-wide uppercase">{p.nome}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {view.galeriaUrls.length > 0 && (
          <section aria-labelledby={SECTION.galeria} id={SECTION.galeria} className="flex scroll-mt-4 flex-col gap-8">
            <Title id={SECTION.galeria} count={view.galeriaUrls.length}>Galeria</Title>
            <ul className="grid auto-rows-[150px] grid-cols-2 gap-3 @3xl:auto-rows-[200px] @3xl:grid-cols-4">
              {view.galeriaUrls.map((url, i) => <li key={`${url}-${i}`} className={`overflow-hidden rounded-2xl border border-border ${mosaic[i % mosaic.length]}`}><GalleryPhoto url={url} index={i} nome={view.nome} className="transition-transform duration-500 hover:scale-105" /></li>)}
            </ul>
          </section>
        )}

        <section aria-labelledby="contato-titulo" id={SECTION.contato} className="flex scroll-mt-4 flex-col gap-6 rounded-3xl bg-primary p-7 text-primary-foreground @3xl:flex-row @3xl:items-end @3xl:justify-between @3xl:p-12">
          <div className="flex min-w-0 flex-col gap-3">
            <h2 id="contato-titulo" className="font-display text-4xl leading-none font-extrabold uppercase @3xl:text-6xl">Contato</h2>
            {view.endereco && <p className="flex items-start gap-3 text-lg font-medium"><MapPin aria-hidden="true" className="mt-1 h-5 w-5 shrink-0" />{view.endereco}</p>}
            {tel && <p className="flex items-center gap-3 text-lg font-medium"><Phone aria-hidden="true" className="h-5 w-5 shrink-0" /><a href={tel} className="underline-offset-4 hover:underline">{prettyPhone(view.telefone)}</a></p>}
          </div>
          {view.services.length > 0 && <a href={`#${SECTION.servicos}`} className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-background px-7 text-base font-semibold text-foreground transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground">Agendar horário<ArrowUpRight aria-hidden="true" className="h-4 w-4" /></a>}
        </section>
      </div>
    </div>
  )
}
