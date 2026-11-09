import { Phone, Scissors } from "lucide-react"
import { ProfessionalPhoto } from "@/features/catalog/components/ProfessionalPhoto"
import { formatPrice } from "@/features/catalog/domain"
import { Heading, ContactLines, CoverImage, GalleryPhoto, LinkButton, ReserveButton, SECTION, ServiceNameButton, ShopMark, telHref } from "./shared"
import type { TemplateProps } from "./types"

const SERIF = "font-[family-name:var(--font-classico)]"

/** Ornamento: duas filetes com a tesoura no meio. */
function Ornament() {
  return (
    <div aria-hidden="true" className="flex items-center justify-center gap-4 text-foreground/70">
      <span className="h-px w-16 bg-foreground/30 @3xl:w-28" /><Scissors className="h-4 w-4" /><span className="h-px w-16 bg-foreground/30 @3xl:w-28" />
    </div>
  )
}

const Title = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <div className="flex flex-col items-center gap-3 text-center">
    <h2 id={id} className={`${SERIF} text-3xl font-semibold tracking-wide @3xl:text-4xl`}>{children}</h2>
    <Ornament />
  </div>
)

/** Clássico: marfim e serifa; cabeçalho centralizado, foto emoldurada, serviços como cardápio com pontilhado e equipe em retratos redondos. */
export function ClassicoTemplate({ view, onReserve, onOpenService, headingLevel = 1 }: TemplateProps) {
  const tel = telHref(view.telefone)
  const links = [
    view.services.length > 0 && ["Serviços", `#${SECTION.servicos}`],
    view.professionals.length > 0 && ["Profissionais", `#${SECTION.equipe}`],
    view.galeriaUrls.length > 0 && ["Galeria", `#${SECTION.galeria}`],
    ["Contato", `#${SECTION.contato}`],
  ].filter(Boolean) as string[][]
  return (
    <div className="bg-background text-foreground">
      <header className="mx-auto flex w-[min(100%-2rem,1040px)] flex-col items-center gap-4 pt-8 pb-5 text-center">
        <ShopMark view={view} className="h-16 w-16 rounded-full ring-1 ring-foreground/25 ring-offset-4 ring-offset-background text-2xl" />
        <p className={`${SERIF} text-lg tracking-[0.18em] uppercase`}>{view.nome}</p>
        <nav aria-label="Seções do site" className="flex flex-wrap justify-center gap-x-7 gap-y-1 border-y border-foreground/20 py-2 text-sm tracking-wide">
          {links.map(([label, href]) => <a key={href} href={href} className="underline-offset-8 transition-colors hover:underline decoration-primary decoration-2">{label}</a>)}
        </nav>
      </header>

      <section className="mx-auto flex w-[min(100%-2rem,1040px)] flex-col items-center gap-6 pb-14 text-center">
        <div className="w-full rounded-sm border border-foreground/25 p-2 @3xl:p-3">
          <CoverImage view={view} className="aspect-[16/8] w-full rounded-[2px]" />
        </div>
        <Heading level={headingLevel} className={`${SERIF} max-w-[18ch] text-4xl leading-tight font-semibold @3xl:text-6xl`}>{view.nome}</Heading>
        <Ornament />
        {view.descricao && <p className={`${SERIF} max-w-[52ch] text-lg leading-relaxed italic text-muted-foreground @3xl:text-xl`}>{view.descricao}</p>}
        <div className="flex flex-wrap justify-center gap-3">
          {view.services.length > 0 && <LinkButton href={`#${SECTION.servicos}`} className="rounded-sm">Agendar horário</LinkButton>}
          {tel && <LinkButton href={tel} variant="outline" className="rounded-sm"><Phone aria-hidden="true" className="h-4 w-4" />Ligar</LinkButton>}
        </div>
      </section>

      <div className="mx-auto flex w-[min(100%-2rem,1040px)] flex-col gap-16 pb-16">
        {view.services.length > 0 && (
          <section aria-labelledby={SECTION.servicos} id={SECTION.servicos} className="flex scroll-mt-4 flex-col gap-8">
            <Title id={SECTION.servicos}>Serviços</Title>
            <ul aria-label="Serviços" className="mx-auto flex w-full max-w-3xl flex-col divide-y divide-foreground/15">
              {view.services.map((item) => (
                <li key={item.id} className="flex items-start gap-4 py-5">
                  {item.photos[0] && <img src={item.photos[0]} alt="" loading="lazy" className="hidden h-20 w-20 shrink-0 rounded-sm border border-foreground/20 object-cover @3xl:block" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <ServiceNameButton service={item} onOpen={onOpenService} className={`${SERIF} text-xl font-semibold hover:underline`} />
                      <span aria-hidden="true" className="min-w-6 flex-1 translate-y-[-4px] border-b border-dotted border-foreground/40" />
                      <span className={`${SERIF} text-xl font-semibold tabular-nums`}>{formatPrice(item.preco_centavos)}</span>
                    </div>
                    {item.descricao && <p className="mt-1 text-sm text-muted-foreground">{item.descricao}</p>}
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-xs tracking-wider text-muted-foreground uppercase">{item.duracao_min} min</span>
                      <ReserveButton service={item} onReserve={onReserve} className="rounded-sm" />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {view.professionals.length > 0 && (
          <section aria-labelledby="equipe-titulo" id={SECTION.equipe} className="flex scroll-mt-4 flex-col gap-8">
            <Title id="equipe-titulo">Profissionais</Title>
            <ul className="flex flex-wrap justify-center gap-x-10 gap-y-6">
              {view.professionals.map((p) => (
                <li key={p.id} className="flex w-32 flex-col items-center gap-3 text-center">
                  <ProfessionalPhoto nome={p.nome} path={p.avatar_path} className={`${SERIF} h-28 w-28 rounded-full text-4xl ring-1 ring-foreground/25 ring-offset-4 ring-offset-background`} />
                  <span className={`${SERIF} text-lg font-semibold`}>{p.nome}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {view.galeriaUrls.length > 0 && (
          <section aria-labelledby={SECTION.galeria} id={SECTION.galeria} className="flex scroll-mt-4 flex-col gap-8">
            <Title id={SECTION.galeria}>Galeria</Title>
            <ul className="grid grid-cols-2 gap-5 @3xl:grid-cols-3">
              {view.galeriaUrls.map((url, i) => (
                <li key={`${url}-${i}`} className="rounded-sm border border-foreground/20 bg-card p-2 pb-4 shadow-sm">
                  <GalleryPhoto url={url} index={i} nome={view.nome} className="aspect-[4/5] rounded-[2px]" />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="contato-titulo" id={SECTION.contato} className="mx-auto flex w-full max-w-3xl scroll-mt-4 flex-col items-center gap-6 rounded-sm border border-foreground/25 p-8 text-center">
          <Title id="contato-titulo">Contato</Title>
          <ContactLines view={view} className="items-center text-center" />
          {view.services.length > 0 && <LinkButton href={`#${SECTION.servicos}`} className="rounded-sm">Agendar horário</LinkButton>}
        </section>
      </div>
    </div>
  )
}
