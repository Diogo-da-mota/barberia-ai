import { MapPin, Phone } from "lucide-react"
import { formatPhone, phoneDigits } from "@/lib/br"

/** Template padrão do site da barbearia. A página pública e a pré-visualização do painel usam estes mesmos blocos. */

type HeroProps = {
  nome: string
  descricao?: string | null
  endereco?: string | null
  telefone?: string | null
  capaUrl?: string | null
  logoUrl?: string | null
  headingLevel?: 1 | 2
}

export function SiteHero({ nome, descricao, endereco, telefone, capaUrl, logoUrl, headingLevel = 1 }: HeroProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2"
  const digits = telefone?.replace(/\D/g, "") ?? ""
  return (
    <section className="overflow-hidden rounded-card border border-border bg-card shadow-sm">
      <div className="relative h-36 bg-gradient-to-br from-primary/30 via-primary/10 to-surface-alt sm:aspect-[3/1] sm:h-auto">
        {capaUrl && <img src={capaUrl} alt={`Capa de ${nome}`} className="absolute inset-0 h-full w-full object-cover" />}
      </div>
      <div className="flex flex-col gap-3 px-4 pb-5 sm:px-6">
        {/* a logo fica metade sobre a capa e metade para baixo, sem borda; relative z-10 a põe NA FRENTE da capa (que é relative) */}
        <div className="relative z-10 -mt-10 flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-alt shadow-sm sm:-mt-12 sm:h-24 sm:w-24">
          {logoUrl ? (
            <img src={logoUrl} alt={`Logo de ${nome}`} className="h-full w-full object-cover" />
          ) : (
            <span data-testid="site-logo-fallback" aria-hidden="true" className="flex h-full w-full items-center justify-center bg-primary font-display text-3xl font-bold text-primary-foreground">
              {nome.trim().charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <Heading className="font-display text-[28px] leading-tight font-bold tracking-wide sm:text-4xl">{nome}</Heading>
        {descricao && <p className="max-w-prose text-base text-muted-foreground">{descricao}</p>}
        {(endereco || digits) && (
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            {endereco && <li className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0" aria-hidden="true" /><span>{endereco}</span></li>}
            {digits && (
              <li className="flex items-center gap-2">
                <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                <a href={`tel:+55${phoneDigits(digits)}`} className="underline-offset-4 hover:underline">{formatPhone(telefone ?? "")}</a>
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  )
}

/** Título de seção do site público: o mesmo peso e espaçamento em Serviços, Galeria e demais blocos. */
export function SiteSectionTitle({ id, children, hint }: { id: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className="font-display text-2xl leading-tight font-bold tracking-wide">{children}</h2>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function SiteGallery({ nome, urls }: { nome: string; urls: string[] }) {
  if (urls.length === 0) return null
  return (
    <section aria-labelledby="galeria" className="flex flex-col gap-4">
      <SiteSectionTitle id="galeria">Galeria</SiteSectionTitle>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {urls.map((url, index) => (
          <li key={`${url}-${index}`}>
            <img src={url} alt={`Foto ${index + 1} de ${nome}`} loading="lazy" className="aspect-square w-full rounded-md border border-border object-cover" />
          </li>
        ))}
      </ul>
    </section>
  )
}
