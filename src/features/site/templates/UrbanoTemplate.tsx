import { MapPin, Phone, Scissors, Users } from "lucide-react"
import { ServiceCard } from "@/features/catalog/components/ServiceCard"
import { ProfessionalPhoto } from "@/features/catalog/components/ProfessionalPhoto"
import { Heading, ContactLines, CoverImage, GalleryPhoto, LinkButton, ReserveButton, SECTION, ShopMark, prettyPhone, telHref } from "./shared"
import type { TemplateProps } from "./types"

const SectionTitle = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <h2 id={id} className="font-display text-3xl leading-none font-bold tracking-wide @5xl:text-4xl">{children}</h2>
)

/** Urbano: preto, hero em duas metades (texto à esquerda, fotografia sangrando à direita), faixa de informações reais e serviços em cartões. */
export function UrbanoTemplate({ view, onReserve, onOpenService, headingLevel = 1 }: TemplateProps) {
  const tel = telHref(view.telefone)
  const links = [["Início", "#inicio"], ["Serviços", `#${SECTION.servicos}`], ["Profissionais", `#${SECTION.equipe}`], ["Galeria", `#${SECTION.galeria}`], ["Contato", `#${SECTION.contato}`]].filter(([label]) =>
    label === "Início" || (label === "Serviços" && view.services.length > 0) || (label === "Profissionais" && view.professionals.length > 0) || (label === "Galeria" && view.galeriaUrls.length > 0) || label === "Contato")
  const facts = [
    view.services.length > 0 && { icon: Scissors, label: "Serviços", value: String(view.services.length) },
    view.professionals.length > 0 && { icon: Users, label: "Profissionais", value: String(view.professionals.length) },
    view.endereco && { icon: MapPin, label: "Endereço", value: view.endereco },
    view.telefone && { icon: Phone, label: "Telefone", value: prettyPhone(view.telefone) },
  ].filter(Boolean) as { icon: typeof Scissors; label: string; value: string }[]

  return (
    <div id="inicio" className="bg-background text-foreground">
      <header className="mx-auto flex w-[min(100%-2rem,1180px)] items-center justify-between gap-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <ShopMark view={view} className="h-11 w-11 shrink-0 rounded-lg text-xl" />
          <span className="truncate font-display text-xl font-bold tracking-wide">{view.nome}</span>
        </div>
        <nav aria-label="Seções do site" className="hidden items-center gap-6 text-sm @3xl:flex">
          {links.map(([label, href]) => <a key={href} href={href} className="text-muted-foreground underline-offset-8 transition-colors hover:text-foreground hover:underline decoration-primary decoration-2">{label}</a>)}
        </nav>
        {view.services.length > 0 && <LinkButton href={`#${SECTION.servicos}`} className="shrink-0">Agendar horário</LinkButton>}
      </header>

      <section className="relative isolate flex flex-col overflow-hidden border-y border-border @3xl:block">
        <div className="mx-auto grid w-[min(100%-2rem,1180px)] @3xl:min-h-[460px] @3xl:grid-cols-[1.05fr_1fr] @5xl:min-h-[540px]">
          <div className="relative z-10 flex flex-col justify-center gap-5 py-10 @3xl:py-16">
            <Heading level={headingLevel} className="font-display text-5xl leading-[0.95] font-bold tracking-wide @3xl:text-6xl @5xl:text-7xl">{view.nome}</Heading>
            {view.descricao && <p className="max-w-[46ch] text-lg text-muted-foreground">{view.descricao}</p>}
            <div className="flex flex-wrap gap-3">
              {view.services.length > 0 && <LinkButton href={`#${SECTION.servicos}`}>Agendar horário</LinkButton>}
              {tel && <LinkButton href={tel} variant="outline"><Phone aria-hidden="true" className="h-4 w-4" />Ligar agora</LinkButton>}
            </div>
          </div>
        </div>
        <div className="relative -order-1 h-56 @3xl:absolute @3xl:inset-y-0 @3xl:right-0 @3xl:order-none @3xl:h-auto @3xl:w-[58%]">
          <CoverImage view={view} className="absolute inset-0 h-full w-full" />
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent @3xl:bg-gradient-to-r @3xl:from-background @3xl:via-background/30 @3xl:to-transparent" />
        </div>
      </section>

      {facts.length > 0 && (
        <ul className="mx-auto grid w-[min(100%-2rem,1180px)] grid-cols-2 gap-y-5 py-8 @3xl:grid-cols-[repeat(auto-fit,minmax(0,1fr))] @3xl:divide-x @3xl:divide-border">
          {facts.map(({ icon: Icon, label, value }) => (
            <li key={label} className="flex min-w-0 items-center gap-3 @3xl:px-6 first:@3xl:pl-0">
              <Icon aria-hidden="true" className="h-6 w-6 shrink-0 text-primary" />
              <span className="min-w-0"><span className="block text-xs text-muted-foreground">{label}</span><span className="block truncate text-sm font-semibold">{value}</span></span>
            </li>
          ))}
        </ul>
      )}

      <div className="mx-auto flex w-[min(100%-2rem,1180px)] flex-col gap-14 pb-16 pt-4">
        {view.services.length > 0 && (
          <section aria-labelledby={SECTION.servicos} id={SECTION.servicos} className="flex scroll-mt-4 flex-col gap-6">
            <div className="flex flex-col gap-1">
              <SectionTitle id={SECTION.servicos}>Serviços</SectionTitle>
              <p className="text-sm text-muted-foreground">Escolha um serviço e toque em Reservar para marcar o profissional, o dia e o horário.</p>
            </div>
            <ul aria-label="Serviços" className="grid gap-4 @3xl:grid-cols-2 @5xl:grid-cols-3">
              {view.services.map((item) => (
                <li key={item.id} className="flex">
                  <ServiceCard service={{ ...item, ativo: true, descricao: item.descricao ?? null }} photos={item.photos} onOpen={() => onOpenService(item.id)} action={<ReserveButton service={item} onReserve={onReserve} className="h-11 md:h-10" />} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {view.professionals.length > 0 && (
          <section aria-labelledby="equipe-titulo" id={SECTION.equipe} className="flex scroll-mt-4 flex-col gap-6">
            <SectionTitle id="equipe-titulo">Profissionais</SectionTitle>
            <ul className="grid grid-cols-2 gap-4 @3xl:grid-cols-4 @5xl:grid-cols-5">
              {view.professionals.map((p) => (
                <li key={p.id} className="flex flex-col gap-3 rounded-card border border-border bg-card p-3">
                  <ProfessionalPhoto nome={p.nome} path={p.avatar_path} className="aspect-square w-full rounded-lg text-4xl" />
                  <span className="px-1 pb-1 font-display text-lg font-semibold tracking-wide">{p.nome}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {view.galeriaUrls.length > 0 && (
          <section aria-labelledby={SECTION.galeria} id={SECTION.galeria} className="flex scroll-mt-4 flex-col gap-6">
            <SectionTitle id={SECTION.galeria}>Galeria</SectionTitle>
            <ul className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
              {view.galeriaUrls.map((url, i) => (
                <li key={`${url}-${i}`} className={i === 0 && view.galeriaUrls.length > 2 ? "col-span-2 row-span-2 @3xl:col-span-2" : ""}>
                  <GalleryPhoto url={url} index={i} nome={view.nome} className="aspect-square rounded-card border border-border" />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="contato-titulo" id={SECTION.contato} className="flex scroll-mt-4 flex-col gap-5 rounded-card border border-border bg-card p-6 @3xl:flex-row @3xl:items-center @3xl:justify-between @3xl:p-8">
          <div className="flex flex-col gap-4">
            <SectionTitle id="contato-titulo">Contato</SectionTitle>
            <ContactLines view={view} iconClassName="text-primary" />
          </div>
          {view.services.length > 0 && <LinkButton href={`#${SECTION.servicos}`} className="h-12 px-7 text-base">Agendar horário</LinkButton>}
        </section>
      </div>
    </div>
  )
}
