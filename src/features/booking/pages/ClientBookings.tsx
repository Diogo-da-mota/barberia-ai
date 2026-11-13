import { useEffect, useState } from "react"
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Ban, CalendarCheck, CalendarDays, ChevronRight, Clock, Plus, type LucideIcon } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { ClientHeader } from "@/app/ClientHeader"
import { PublicHeader } from "@/app/PublicHeader"
import { AuthDialog } from "@/features/auth/components/AuthDialog"
import { AuthGuard } from "@/features/auth/components/AuthGuard"
import { rememberShop } from "@/features/auth/lastShop"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { CALLBACK_NOTICES, type AuthView, type CallbackError } from "@/features/auth/domain"
import { useShopAccent } from "@/lib/appearance"
import { Button } from "@/ui/button"
import { EmptyState, Panel } from "@/ui/finance"
import { Skeleton } from "@/ui/skeleton"
import { servicePhotos } from "@/features/catalog/domain"
import { publicMediaUrl } from "@/features/site/api"
import { DEFAULT_TEMPLATE, isTemplateId } from "@/features/site/templates"
import { isLightTemplate, paletteStyle } from "@/features/site/templates/palette"
import { cn } from "@/lib/utils"
import { useMediaQuery } from "@/lib/useMediaQuery"
import { shopAuthPath, shopBookingsPath, shopPath } from "@/lib/shopPaths"
import { getPublicShop } from "../api"
import { ClientReservationCard } from "../components/ClientReservationCard"
import { CompleteWhatsApp } from "../components/CompleteWhatsApp"
import { useReservations } from "../hooks/useReservations"
import { isMissingSchema, type BookingRow, type PublicShopData } from "../domain"

/** Porta do cliente final: pede conta (e-mail e senha ou Google) para ele ver as próprias reservas. */
/** Com `onOpen` (página de barbearia) os botões levam à porta do cliente dela (/slug/entrar); sem ele (/acesso) o acesso abre aqui. */
export function ClientLogin({ next, title = "Acesso do cliente", onOpen, notice = null }: { next: string; title?: string; onOpen?: (view: AuthView) => void; notice?: string | null }) {
  const [view, setView] = useState<AuthView | null>(notice ? "entrar" : null)
  const { session, loading } = useAuth()
  return (
    <>
      <Panel className="flex flex-col items-center gap-4 p-8 text-center">
        <h1 className="font-display text-2xl font-bold tracking-wide">{title}</h1>
        <p className="max-w-[44ch] text-sm text-muted-foreground">Entre ou crie sua conta com e-mail e senha para ver, reagendar e cancelar suas reservas.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button className="h-11 md:h-10" onClick={() => (onOpen ?? setView)("entrar")}>Entrar</Button>
          <Button variant="outline" className="h-11 md:h-10" onClick={() => (onOpen ?? setView)("criar-conta")}>Criar conta</Button>
        </div>
      </Panel>
      {!onOpen && <AuthDialog open={Boolean(view) && !loading && !session} view={view} next={next} notice={notice} onViewChange={setView} onClose={() => setView(null)} client />}
    </>
  )
}

const SERIF = "font-[family-name:var(--font-classico)]"

/**
 * Subtítulo na cor de destaque da barbearia. A cor pura de alguns destaques (violeta, verde sobre fundo claro) não alcança contraste AA em texto
 * pequeno; por isso ela é misturada com a cor do texto do modelo (clara no escuro, escura no claro) só neste texto, sem opacity.
 */
const Eyebrow = ({ children, light }: { children: React.ReactNode; light: boolean }) => (
  <p className="flex items-center gap-3 text-xs font-semibold tracking-[0.22em] uppercase" style={{ color: `color-mix(in oklab, var(--primary) ${light ? 45 : 72}%, var(--foreground))` }}>
    {children}<span aria-hidden="true" className="h-px w-10 bg-primary" />
  </p>
)

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Fotografia decorativa da coluna lateral. A moldura segue a proporção REAL da imagem (entre 1:1 e 2,4:1), então nada é ampliado nem
 * cortado além do necessário. Sem fotografia, um fundo neutro com o brilho da cor de destaque (nunca a logo ampliada).
 */
function AsidePhoto({ url }: { url: string | null }) {
  const [aspect, setAspect] = useState(1.6)
  return (
    <div className="relative overflow-hidden bg-surface-alt" style={url ? { aspectRatio: aspect } : { height: 160 }}>
      {url ? (
        <img src={url} alt="" onLoad={(e) => setAspect(clamp(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight, 1, 2.4))} className="absolute inset-0 h-full w-full object-cover object-center" />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(80%_100%_at_30%_0%,color-mix(in_oklab,var(--primary)_22%,transparent),transparent)]" />
      )}
      {/* escurece só a base, onde o texto encosta na foto */}
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-background from-5% via-background/50 via-40% to-transparent" />
    </div>
  )
}

function SectionTitle({ id, icon: Icon, title, hint }: { id: string; icon: LucideIcon; title: string; hint: string }) {
  return (
    <div className="flex items-center gap-4">
      <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-border bg-primary/10 text-primary"><Icon className="h-6 w-6" /></span>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4">
        <h2 id={id} className={cn(SERIF, "text-3xl font-semibold")}>{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}

/** /:slug/minhas-reservas: reservas do cliente com a cara da barbearia (marca, cor, template e fotos dos serviços), sem o painel. */
export function ClientBookings() {
  const { slug = "" } = useParams()
  const location = useLocation()
  const shop = useQuery({ queryKey: ["public-shop", slug], queryFn: () => getPublicShop(slug) })
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const openAuth = (view: AuthView) => navigate(shopAuthPath(slug, view), { state: { from: location.pathname } })
  useShopAccent(shop.data?.cor_destaque)
  useEffect(() => { if (shop.data) rememberShop(slug) }, [shop.data, slug])
  const template = isTemplateId(shop.data?.template) ? shop.data.template : DEFAULT_TEMPLATE

  return (
    <div className="min-h-dvh bg-background text-foreground" style={shop.data ? paletteStyle(template) : undefined}>
      <ClientHeader slug={slug} shop={shop.data} onLogin={() => openAuth("entrar")} />
      {!shop.data && shop.isPending ? (
        <main className="mx-auto flex w-[min(100%-2rem,880px)] flex-col gap-6 py-10"><div role="status" aria-label="Carregando a barbearia" className="flex flex-col gap-3"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-40 w-full" /></div></main>
      ) : !shop.data ? (
        <main className="mx-auto flex w-[min(100%-2rem,880px)] flex-col gap-6 py-10">
          <EmptyState title="Barbearia não encontrada" description="Confira o endereço da página ou fale com a barbearia." action={<Button asChild className="h-11"><Link to="/">Voltar ao início</Link></Button>} />
        </main>
      ) : loading ? (
        <main className="mx-auto flex w-[min(100%-2rem,880px)] flex-col gap-6 py-10"><Skeleton className="h-40 w-full" /></main>
      ) : !session ? (
        <main className="mx-auto flex w-[min(100%-2rem,880px)] flex-col gap-6 py-10"><ClientLogin next={location.pathname} title={`Acesso — ${shop.data.nome}`} onOpen={openAuth} /></main>
      ) : (
        <AuthGuard loginPath={() => shopBookingsPath(slug)}>
          <ClientArea slug={slug} shop={shop.data} light={isLightTemplate(template)} userName={String(session.user.user_metadata?.full_name ?? session.user.user_metadata?.name ?? "")} />
        </AuthGuard>
      )}
    </div>
  )
}

function ClientArea({ slug, shop, userName, light }: { slug: string; shop: PublicShopData; userName: string; light: boolean }) {
  const { bookings, rows, upcoming, history, tz, askCancel, askMove, dialogs } = useReservations(slug)
  // fotografia decorativa: primeiro uma foto do ambiente (galeria), depois a capa; nunca a logo
  const decorative = (shop.galeria ?? []).map((path) => publicMediaUrl(path)).find(Boolean) ?? publicMediaUrl(shop.capa_path)
  const photoOf = (b: BookingRow) => {
    const service = shop.services.find((x) => x.id === b.service_id)
    return service ? servicePhotos(service, (path) => publicMediaUrl(path) ?? "").find(Boolean) ?? null : null
  }
  const first = userName.trim().split(/\s+/)[0]
  const counts = [
    { label: "Próximas reservas", total: upcoming.length, icon: CalendarDays, href: "#proximas" },
    { label: "Reservas no histórico", total: history.length, icon: Clock, href: "#historico" },
  ]
  const newBooking = <Button asChild className="h-12 w-full gap-2 text-base"><Link to={shopPath(slug)}><Plus aria-hidden="true" className="h-5 w-5" />Nova reserva</Link></Button>
  const ready = Boolean(bookings.data) && !bookings.isError
  const wide = useMediaQuery("(min-width: 1024px)") // coluna lateral no desktop; faixa compacta no tablet e no celular (um só "Nova reserva" na tela)

  const card = (b: BookingRow, withActions: boolean) => (
    <ClientReservationCard
      key={b.id} booking={b} tz={tz(b)} photo={photoOf(b)}
      actions={withActions && (
        <>
          <Button variant="outline" className="h-11 flex-1 gap-2 border-primary/60 text-primary hover:bg-primary/10 sm:flex-none" onClick={() => askMove(b)}><CalendarCheck aria-hidden="true" className="h-4 w-4" />Reagendar</Button>
          <Button variant="outline" className="h-11 flex-1 gap-2 text-muted-foreground sm:flex-none" onClick={() => askCancel(b)}><Ban aria-hidden="true" className="h-4 w-4" />Cancelar reserva</Button>
        </>
      )}
    />
  )

  return (
    <div className="relative isolate">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_45%_at_90%_0%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent)]" />
      <div className="mx-auto grid w-full max-w-[1600px] lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        {wide && <aside aria-label="Área do cliente" className="flex flex-col border-r border-border">
          <AsidePhoto url={decorative} />
          <div className="relative z-10 -mt-10 flex flex-col gap-8 px-8 pb-10">
            <div className="flex flex-col gap-3">
              <Eyebrow light={light}>Área do cliente</Eyebrow>
              <h2 className={cn(SERIF, "text-4xl leading-tight font-semibold text-foreground")}>Minhas reservas</h2>
              <p className="text-[15px] leading-relaxed text-muted-foreground">Atendimentos agendados, histórico de visitas e próximos compromissos na {shop.nome}.</p>
            </div>
            <section aria-labelledby="resumo" className="flex flex-col gap-4 rounded-2xl border border-border bg-card/80 p-5">
              <div className="flex items-center gap-4">
                <span aria-hidden="true" className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-border bg-primary/10 text-primary"><CalendarCheck className="h-7 w-7" /></span>
                <div><h3 id="resumo" className="font-display text-xl font-bold">Resumo das reservas</h3><p className="text-sm text-muted-foreground">Sua agenda na barbearia</p></div>
              </div>
              <ul className="flex flex-col divide-y divide-border">
                {counts.map(({ label, total, icon: Icon, href }) => (
                  <li key={label}>
                    <a href={href} className="flex min-h-12 items-center gap-3 py-2 text-[15px] transition-colors hover:text-primary">
                      <Icon aria-hidden="true" className="h-5 w-5 text-muted-foreground" /><span className="flex-1">{label}</span>
                      <span className="font-semibold tabular-nums">{ready ? total : "–"}</span><ChevronRight aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                    </a>
                  </li>
                ))}
              </ul>
              {newBooking}
            </section>
          </div>
        </aside>}

        <main className="flex min-w-0 flex-col gap-8 px-4 py-6 sm:px-8 lg:gap-10 lg:px-12 lg:py-12">
          <header className="flex flex-col gap-4">
            <Eyebrow light={light}>Olá, {first || "cliente"}</Eyebrow>
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2 border-b border-border pb-6">
              <h1 className={cn(SERIF, "text-4xl leading-none font-semibold sm:text-5xl")}>Suas reservas</h1>
              <p className="text-[15px] text-muted-foreground">Agende, acompanhe e gerencie seus atendimentos.</p>
            </div>
            {/* celular e tablet: o resumo vira uma faixa compacta, sem a coluna lateral */}
            {!wide && <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card/80 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-6" role="group" aria-label="Resumo das reservas">
                {counts.map(({ label, total, href }) => (
                  <a key={label} href={href} className="flex flex-col"><span className="font-display text-3xl leading-none font-bold tabular-nums">{ready ? total : "–"}</span><span className="text-[13px] text-muted-foreground">{label}</span></a>
                ))}
              </div>
              <div className="sm:w-52">{newBooking}</div>
            </div>}
          </header>

          <CompleteWhatsApp />
          {isMissingSchema(bookings.error) ? (
            <Panel><EmptyState title="Reservas indisponíveis" description="O agendamento ainda está sendo preparado no banco de dados." /></Panel>
          ) : bookings.isError ? (
            <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm font-semibold">Não foi possível carregar suas reservas</p>
              <Button variant="outline" className="h-11" onClick={() => void bookings.refetch()}>Tentar novamente</Button>
            </div>
          ) : !bookings.data ? (
            <div role="status" aria-label="Carregando reservas" className="flex flex-col gap-3"><Skeleton className="h-36 w-full rounded-2xl" /><Skeleton className="h-36 w-full rounded-2xl" /></div>
          ) : rows.length === 0 ? (
            <Panel><EmptyState title="Você ainda não tem reservas" description="Escolha um serviço na página da barbearia para agendar um horário." action={<Button asChild className="h-11"><Link to={shopPath(slug)}>Agendar um horário</Link></Button>} /></Panel>
          ) : (
            <>
              <section aria-labelledby="proximas" className="flex scroll-mt-24 flex-col gap-5">
                <SectionTitle id="proximas" icon={CalendarDays} title="Próximas" hint="Seus próximos atendimentos" />
                {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma reserva ativa.</p> : <ul className="flex flex-col gap-4">{upcoming.map((b) => card(b, true))}</ul>}
              </section>
              {history.length > 0 && (
                <section aria-labelledby="historico" className="flex scroll-mt-24 flex-col gap-5">
                  <SectionTitle id="historico" icon={Clock} title="Histórico" hint="Seus atendimentos anteriores" />
                  <ul className="flex flex-col gap-4">{history.map((b) => card(b, false))}</ul>
                </section>
              )}
            </>
          )}
        </main>
      </div>
      {dialogs}
    </div>
  )
}

/** /acesso — porta neutra do cliente quando não sabemos de qual barbearia ele veio. */
export function ClientAccess() {
  const [searchParams] = useSearchParams() // ?erro= vindo do /auth/callback (ex.: e-mail confirmado em outro navegador)
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <PublicHeader />
      <main className="mx-auto flex w-[min(100%-2rem,560px)] flex-col gap-6 py-10">
        <ClientLogin next="/minhas-reservas" notice={CALLBACK_NOTICES[searchParams.get("erro") as CallbackError] ?? null} />
        <p className="text-center text-sm text-muted-foreground">Para agendar, abra a página da sua barbearia.</p>
      </main>
    </div>
  )
}
