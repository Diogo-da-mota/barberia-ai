import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { Link, useLocation, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { PublicHeader } from "@/app/PublicHeader"
import { AuthDialog } from "@/features/auth/components/AuthDialog"
import type { AuthView } from "@/features/auth/domain"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { formatDuration, formatPrice } from "@/features/catalog/domain"
import { Button } from "@/ui/button"
import { EmptyState, Field, Panel } from "@/ui/finance"
import { Input } from "@/ui/input"
import { Skeleton } from "@/ui/skeleton"
import { rememberShop } from "@/features/auth/lastShop"
import { applySeo, seoFor } from "@/features/site/domain"
import { useShopAccent } from "@/lib/appearance"
import { publicMediaUrl } from "@/features/site/api"
import { DEFAULT_TEMPLATE, SiteRenderer, isTemplateId } from "@/features/site/templates"
import { paletteStyle } from "@/features/site/templates/palette"
import { buildSiteView } from "@/features/site/templates/view"
import { PhoneInput } from "@/ui/phone-input"
import { phoneDigits } from "@/lib/br"
import { ServiceDetailDialog } from "../components/ServiceDetailDialog"
import { BookingDialog, ProfessionalChoice } from "../components/BookingDialog"
import { servicePhotos } from "@/features/catalog/domain"
import { createBooking, getPublicShop } from "../api"
import { SlotPicker } from "../components/SlotPicker"
import { bookingErrorMessage, formatDateTime, isMissingSchema, validateContact, type Slot } from "../domain"
import { isShopSection, shopBookingsPath, shopPath } from "@/lib/shopPaths"

const DRAFT_KEY = "barberia:booking-draft"

type Draft = { slug: string; serviceId: string | null; professionalId: string; nome: string; whatsapp: string }

function readDraft(slug: string): Draft | null {
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null") as Draft | null
    return draft?.slug === slug ? draft : null
  } catch {
    return null
  }
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <Panel className="flex flex-col gap-4 p-4 sm:p-5">
      <h2 className="flex items-center gap-3 font-display text-xl font-semibold tracking-wide">
        <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-primary text-base font-bold text-primary-foreground">{number}</span>
        {title}
      </h2>
      {children}
    </Panel>
  )
}

export function PublicShop() {
  const { slug = "" } = useParams()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { session, loading } = useAuth()
  const draft = useRef(readDraft(slug)).current

  const [serviceId, setServiceId] = useState<string | null>(draft?.serviceId ?? null)
  const [professionalId, setProfessionalId] = useState(draft?.professionalId ?? "any")
  const [slot, setSlot] = useState<Slot | null>(null)
  const [nome, setNome] = useState(draft?.nome ?? String(session?.user.user_metadata?.full_name ?? ""))
  const [whatsapp, setWhatsapp] = useState(draft?.whatsapp ?? "")
  const [lembretes, setLembretes] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [authView, setAuthView] = useState<AuthView | null>(null)
  // ao voltar do login com um rascunho salvo, o pop-up da reserva reabre sozinho
  const [bookingOpen, setBookingOpen] = useState(Boolean(draft))
  const key = useRef(crypto.randomUUID())

  const shop = useQuery({ queryKey: ["public-shop", slug], queryFn: () => getPublicShop(slug) })
  const data = shop.data
  useShopAccent(data?.cor_destaque)
  useEffect(() => {
    if (!data) return
    applySeo(document, { ...seoFor(data), image: publicMediaUrl(data.capa_path ?? data.logo_path) ?? undefined })
  }, [data])
  useEffect(() => { if (data) rememberShop(slug) }, [data, slug])
  // /slug/servicos (ou a âncora antiga /slug#servicos): a página só existe depois que os dados chegam, então a rolagem espera por eles
  const pathSection = location.pathname.split("/")[2]
  const sectionId = isShopSection(pathSection) ? pathSection : decodeURIComponent(location.hash.slice(1))
  useEffect(() => {
    if (!data || !sectionId) return
    document.getElementById(sectionId)?.scrollIntoView()
  }, [data, sectionId])
  const [detailId, setDetailId] = useState<string | null>(null)
  const reserve = (id: string) => { setDetailId(null); setServiceId(id); setProfessionalId("any"); setSlot(null); key.current = crypto.randomUUID(); setBookingOpen(true) }
  const detail = data?.services.find((item) => item.id === detailId) ?? null
  const service = data?.services.find((item) => item.id === serviceId) ?? null
  const professionals = data && service ? data.professionals.filter((p) => p.service_ids.includes(service.id)) : []

  const book = useMutation({
    mutationFn: () =>
      createBooking({
        shopId: data!.id, serviceId: service!.id, professionalId: professionalId === "any" ? null : professionalId,
        inicio: slot!.slot_inicio, nome: nome.trim(), whatsapp: phoneDigits(whatsapp), lembretes, marketing, key: key.current,
      }),
    onSuccess: async () => {
      sessionStorage.removeItem(DRAFT_KEY)
      await queryClient.invalidateQueries({ queryKey: ["my-bookings"] })
    },
    onError: (error) => {
      setErrors({ form: bookingErrorMessage(error) })
      // O horário pode ter sido ocupado: recarrega a lista
      void queryClient.invalidateQueries({ queryKey: ["slots"] })
    },
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const found = validateContact({ nome, whatsapp })
    setErrors(found)
    if (Object.keys(found).length > 0 || !slot) return
    if (!session) {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ slug, serviceId, professionalId, nome, whatsapp } satisfies Draft))
      setBookingOpen(false) // um pop-up por vez: o login abre sozinho; ao voltar, a reserva reabre com os dados
      setAuthView("entrar")
      return
    }
    book.mutate()
  }

  const confirmed = book.isSuccess && data && slot && service
  const view = useMemo(() => (data ? buildSiteView({ ...data, logoPath: data.logo_path, capaPath: data.capa_path }) : null), [data])
  const showSite = Boolean(data && view && !confirmed)
  const templateId = isTemplateId(data?.template) ? data.template : DEFAULT_TEMPLATE

  return (
    <div className="min-h-dvh bg-background text-foreground" style={showSite ? paletteStyle(templateId) : undefined}>
      <PublicHeader onLogin={() => setAuthView("entrar")} shopName={data?.nome} slug={slug} />
      {showSite && data && view ? (
        <main>
          {/* O modelo escolhido pela barbearia só APRESENTA os dados; a reserva abaixo é a mesma para os cinco modelos. */}
          <SiteRenderer template={templateId} view={view} basePath={shopPath(slug)} onReserve={reserve} onOpenService={setDetailId} />
          {data.services.length === 0 ? (
            <div className="mx-auto w-[min(100%-2rem,1120px)] py-10"><EmptyState title="Agendamento indisponível" description="Esta barbearia ainda não cadastrou serviços." /></div>
          ) : (
            <>
            <ServiceDetailDialog
              service={detail ? { id: detail.id, nome: detail.nome, descricao: detail.descricao ?? null, preco_centavos: detail.preco_centavos, duracao_min: detail.duracao_min } : null}
              photos={detail ? servicePhotos(detail, (path) => publicMediaUrl(path) ?? "") : []}
              professionals={detail && data ? data.professionals.filter((p) => p.service_ids.includes(detail.id)) : []}
              onClose={() => setDetailId(null)}
              onReserve={reserve}
            />
            <BookingDialog
              open={bookingOpen && Boolean(service)}
              onOpenChange={(open) => { setBookingOpen(open); if (!open) setErrors({}) }}
              serviceName={service?.nome ?? ""}
            >
              <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
                {service && (
                  <Step number={1} title="Escolha o profissional">
                    {professionals.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum profissional atende este serviço no momento.</p>
                    ) : (
                      <ProfessionalChoice
                        items={[{ id: "any", nome: "Qualquer profissional disponível", avatarPath: null }, ...professionals.map((p) => ({ id: p.id, nome: p.nome, avatarPath: p.avatar_path ?? null }))]}
                        selected={professionalId}
                        onSelect={(id) => { setProfessionalId(id); setSlot(null); key.current = crypto.randomUUID() }}
                      />
                    )}
                  </Step>
                )}

                {service && professionals.length > 0 && (
                  <Step number={2} title="Escolha o dia e o horário">
                    <SlotPicker
                      shopId={data.id} tz={data.fuso} serviceId={service.id}
                      professionalId={professionalId === "any" ? null : professionalId}
                      selected={slot?.slot_inicio ?? null}
                      onSelect={(next) => { setSlot(next); key.current = crypto.randomUUID() }}
                    />
                  </Step>
                )}

                {slot && service && (
                  <Step number={3} title="Seus dados">
                    {errors.form && <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{errors.form}</p>}
                    <p className="text-sm text-muted-foreground">
                      {service.nome}, {formatDateTime(slot.slot_inicio, data.fuso)}
                    </p>
                    <Field label="Nome" htmlFor="b-nome" error={errors.nome} errorId="b-nome-erro">
                      <Input id="b-nome" value={nome} autoComplete="name" aria-invalid={errors.nome ? true : undefined} aria-describedby={errors.nome ? "b-nome-erro" : undefined} className="h-11 text-base md:h-10 md:text-sm" onChange={(e) => setNome(e.target.value)} />
                    </Field>
                    <Field label="WhatsApp" htmlFor="b-whats" error={errors.whatsapp} errorId="b-whats-erro">
                      <PhoneInput id="b-whats" defaultValue={whatsapp} onValueChange={setWhatsapp} aria-invalid={errors.whatsapp ? true : undefined} aria-describedby={errors.whatsapp ? "b-whats-erro" : undefined} />
                    </Field>
                    <label className="flex min-h-11 items-center gap-3 text-sm">
                      <input type="checkbox" checked={lembretes} onChange={(e) => setLembretes(e.target.checked)} className="h-5 w-5 shrink-0 accent-primary" />
                      Quero receber avisos e lembretes desta reserva
                    </label>
                    <label className="flex min-h-11 items-center gap-3 text-sm">
                      <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="h-5 w-5 shrink-0 accent-primary" />
                      Aceito receber novidades e promoções da barbearia
                    </label>
                    <Button type="submit" className="h-12 w-full text-base" disabled={book.isPending || loading}>
                      {book.isPending ? "Confirmando…" : session ? "Confirmar reserva" : "Entrar para confirmar"}
                    </Button>
                  </Step>
                )}
              </form>
            </BookingDialog>
            </>
          )}
        </main>
      ) : (
      <main className="mx-auto flex w-[min(100%-2rem,1120px)] flex-col gap-8 py-6 sm:gap-10 sm:py-10">
        {isMissingSchema(shop.error) ? (
          <EmptyState title="Agendamento indisponível" description="Esta página ainda está sendo preparada. Tente novamente mais tarde." />
        ) : shop.isError ? (
          <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm font-semibold">Não foi possível carregar esta barbearia</p>
            <Button variant="outline" className="h-11" onClick={() => void shop.refetch()}>Tentar novamente</Button>
          </div>
        ) : !shop.data && shop.isPending ? (
          <div role="status" aria-label="Carregando a barbearia" className="flex flex-col gap-3">
            <Skeleton className="h-10 w-2/3" /><Skeleton className="h-40 w-full" />
          </div>
        ) : !data ? (
          <EmptyState
            title="Barbearia não encontrada"
            description="Confira o endereço da página ou fale com a barbearia."
            action={<Button asChild className="h-11"><Link to="/">Voltar ao início</Link></Button>}
          />
        ) : confirmed ? (
          <Panel variant="highlight" className="flex flex-col gap-3 p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-income/10 text-income"><Check className="h-5 w-5" aria-hidden="true" /></span>
            <h1 className="font-display text-2xl font-bold tracking-wide">Reserva confirmada</h1>
            <p className="text-base">{service.nome} em {data.nome}</p>
            <p className="text-sm text-muted-foreground">
              {formatDateTime(slot.slot_inicio, data.fuso)} · {formatDuration(service.duracao_min)} · {formatPrice(service.preco_centavos)}
            </p>
            <Button asChild className="h-11 md:h-10"><Link to={shopBookingsPath(slug)}>Ver minhas reservas</Link></Button>
          </Panel>
        ) : null}
      </main>
      )}

      <AuthDialog
        open={Boolean(authView) && !loading && !session}
        view={authView}
        next={location.pathname + location.search}
        notice={null}
        onViewChange={setAuthView}
        onClose={() => setAuthView(null)}
      />
    </div>
  )
}
