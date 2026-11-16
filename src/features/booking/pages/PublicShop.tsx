import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { Link, useLocation, useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { PublicHeader } from "@/app/PublicHeader"
import { AuthDialog } from "@/features/auth/components/AuthDialog"
import { CALLBACK_NOTICES, toAuthView, type AuthView, type CallbackError } from "@/features/auth/domain"
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
import { formatPhone, phoneDigits } from "@/lib/br"
import { ServiceDetailDialog } from "../components/ServiceDetailDialog"
import { BookingDialog, ProfessionalChoice } from "../components/BookingDialog"
import { servicePhotos } from "@/features/catalog/domain"
import { createBooking, fetchMyBookings, getPublicShop } from "../api"
import { SlotPicker } from "../components/SlotPicker"
import { bookingErrorMessage, formatDateTime, isMissingSchema, validateContact, type Slot } from "../domain"
import { isShopSection, shopAuthPath, shopBookingsPath, shopPath } from "@/lib/shopPaths"

const DRAFT_KEY = "barberia:booking-draft"
const DRAFT_TTL_MS = 30 * 60 * 1000

type Draft = {
  slug: string; serviceId: string | null; professionalId: string; slot: Slot | null
  nome: string; whatsapp: string; lembretes: boolean; marketing: boolean; exp: number
}

/**
 * Rascunho da reserva guardado antes do login. Fica no localStorage porque o Google e a confirmação do e-mail
 * (aberta em outra aba) saem da página; vence em 30 min, porque o horário pode ser ocupado.
 */
function readDraft(slug: string): Draft | null {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null") as Draft | null
    return draft?.slug === slug && typeof draft.exp === "number" && draft.exp > Date.now() ? draft : null
  } catch {
    return null
  }
}
function saveDraft(draft: Omit<Draft, "exp">) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, exp: Date.now() + DRAFT_TTL_MS })) } catch { /* sem armazenamento */ }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY) } catch { /* sem armazenamento */ }
}
/** Dia (AAAA-MM-DD) do horário no fuso da barbearia, para o calendário reabrir no dia escolhido. */
const dayOf = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso))

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

  const [serviceId, setServiceId] = useState<string | null>(null)
  const [professionalId, setProfessionalId] = useState("any")
  const [slot, setSlot] = useState<Slot | null>(null)
  // Último horário tocado e quem está livre nele: trocar para um desses profissionais mantém dia e horário; `pulso` = horário ocupado
  const [desejado, setDesejado] = useState<{ livres: Slot[]; pulso: number | null } | null>(null)
  const [nome, setNome] = useState(String(session?.user.user_metadata?.full_name ?? ""))
  const [whatsapp, setWhatsapp] = useState("")
  const [lembretes, setLembretes] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  // Porta do cliente: /slug/entrar, /slug/criar-conta e /slug/recuperar abrem o acesso por cima da página da barbearia.
  const navigate = useNavigate()
  const authView = toAuthView(location.pathname.split("/")[2] ?? null)
  const authState = location.state as { from?: unknown; reserva?: unknown } | null
  const fromState = authState?.from
  const from = typeof fromState === "string" && fromState.startsWith(shopPath(slug)) && !toAuthView(fromState.split("/")[2] ?? null) ? fromState : null
  // Depois de entrar: a reserva volta à página para reabrir; o botão Acesso (ou link direto) vai para as reservas desta barbearia.
  const reservationsPath = shopBookingsPath(slug)
  const afterLogin = from && (authState?.reserva === true || from.split("?", 1)[0] === reservationsPath) ? from : reservationsPath
  const openAuth = (target: AuthView, reserva = false) =>
    navigate(shopAuthPath(slug, target), authView ? { replace: true, state: location.state } : { state: { from: location.pathname, reserva } })
  const closeAuth = () => navigate(from ?? shopPath(slug), { replace: true })
  const [bookingOpen, setBookingOpen] = useState(false)
  const key = useRef(crypto.randomUUID())
  const draftChecked = useRef(false)
  const awaitingLogin = useRef(false)

  // Volta do Google ou da confirmação do e-mail: com a conta aberta, a reserva reabre com serviço, dia, horário e dados.
  // Sem conta aberta o rascunho não é aplicado: em aparelho compartilhado, a próxima pessoa não vê nome e WhatsApp alheios.
  useEffect(() => {
    if (loading || draftChecked.current) return
    draftChecked.current = true
    if (!draft || !session) return
    setServiceId(draft.serviceId)
    setProfessionalId(draft.professionalId)
    setSlot(draft.slot)
    setNome(draft.nome)
    setWhatsapp(draft.whatsapp)
    setLembretes(draft.lembretes)
    setMarketing(draft.marketing)
    setBookingOpen(true)
    clearDraft()
  }, [loading, session, draft])

  // Entrou pelo pop-up nesta mesma página: a reserva reabre como estava.
  useEffect(() => {
    if (!session || !awaitingLogin.current) return
    awaitingLogin.current = false
    setBookingOpen(true)
  }, [session])

  // Entrou pela porta do cliente: vai para as reservas desta barbearia (ou volta à reserva que pediu o login).
  useEffect(() => {
    if (session && authView) navigate(afterLogin, { replace: true })
  }, [session, authView, afterLogin, navigate])

  // Cliente com conta: nome e WhatsApp já vêm preenchidos (da última reserva; o nome, também da conta) e podem ser
  // editados. Só preenche campo vazio: nunca troca o que a pessoa digitou ou o que voltou do rascunho.
  const mine = useQuery({ queryKey: ["my-bookings"], queryFn: fetchMyBookings, enabled: Boolean(session) })
  const prefilled = useRef(false)
  const [phoneVersion, setPhoneVersion] = useState(0) // o campo de telefone só lê o valor inicial: muda a chave para mostrar o preenchido
  useEffect(() => {
    if (!session || !mine.isFetched || prefilled.current) return
    prefilled.current = true
    const last = mine.data?.[0]
    setNome((v) => v || last?.cliente_nome || String(session.user.user_metadata?.full_name ?? ""))
    const phone = last?.cliente_whatsapp || String(session.user.user_metadata?.whatsapp ?? "") // última reserva ou o do cadastro
    if (phone) {
      setWhatsapp((v) => v || formatPhone(phone))
      setPhoneVersion((n) => n + 1)
    }
  }, [session, mine.isFetched, mine.data])

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
  const reserve = (id: string) => { setDetailId(null); setServiceId(id); setProfessionalId("any"); setSlot(null); setDesejado(null); key.current = crypto.randomUUID(); setBookingOpen(true) }
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
      clearDraft()
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
      saveDraft({ slug, serviceId, professionalId, slot, nome, whatsapp, lembretes, marketing })
      awaitingLogin.current = true
      setBookingOpen(false) // um pop-up por vez: o login abre sozinho; ao entrar, a reserva reabre com os dados
      openAuth("entrar", true)
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
      <PublicHeader onLogin={() => openAuth("entrar")} shopName={data?.nome} slug={slug} logoUrl={view?.logoUrl} />
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
                        highlight={desejado?.pulso ? { ids: desejado.livres.map((s) => s.prof_id), nonce: desejado.pulso } : null}
                        onSelect={(id) => {
                          // livre no horário desejado: mantém dia e horário; senão, escolhe de novo
                          setSlot(desejado?.livres.find((s) => id === "any" || s.prof_id === id) ?? null)
                          setDesejado((d) => d && { ...d, pulso: null })
                          setProfessionalId(id); key.current = crypto.randomUUID()
                        }}
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
                      initialDate={slot ? dayOf(slot.slot_inicio, data.fuso) : undefined}
                      onSelect={(next) => {
                        // alternativa a um horário ocupado: a reserva passa para o profissional livre
                        if (professionalId !== "any" && next.prof_id !== professionalId) setProfessionalId(next.prof_id)
                        setSlot(next); setDesejado((d) => d && { ...d, pulso: null }); key.current = crypto.randomUUID()
                      }}
                      onPick={(t) => setDesejado({ livres: t.livres, pulso: t.livre || t.livres.length === 0 ? null : Date.now() })}
                      photos={Object.fromEntries(professionals.map((p) => [p.id, p.avatar_path ?? null]))}
                    />
                  </Step>
                )}

                {slot && service && (
                  <Step number={3} title="Seus dados">
                    {errors.form && <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{errors.form}</p>}
                    <p className="text-sm text-muted-foreground">
                      {service.nome}, {formatDateTime(slot.slot_inicio, data.fuso)}
                    </p>
                    {/* Nome e WhatsApp lado a lado; consentimentos à esquerda e Confirmar à direita (no celular, tudo empilhado) */}
                    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_13rem] sm:items-start">
                      <Field label="Nome" htmlFor="b-nome" error={errors.nome} errorId="b-nome-erro">
                        <Input id="b-nome" value={nome} autoComplete="name" aria-invalid={errors.nome ? true : undefined} aria-describedby={errors.nome ? "b-nome-erro" : undefined} className="h-11 text-base md:h-10 md:text-sm" onChange={(e) => setNome(e.target.value)} />
                      </Field>
                      <Field label="WhatsApp" htmlFor="b-whats" error={errors.whatsapp} errorId="b-whats-erro">
                        <PhoneInput key={phoneVersion} id="b-whats" defaultValue={whatsapp} onValueChange={setWhatsapp} aria-invalid={errors.whatsapp ? true : undefined} aria-describedby={errors.whatsapp ? "b-whats-erro" : undefined} />
                      </Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_13rem] sm:items-center">
                      <div className="flex flex-col">
                        <label className="flex min-h-11 items-center gap-3 text-sm">
                          <input type="checkbox" checked={lembretes} onChange={(e) => setLembretes(e.target.checked)} className="h-5 w-5 shrink-0 accent-primary" />
                          Quero receber avisos e lembretes desta reserva
                        </label>
                        <label className="flex min-h-11 items-center gap-3 text-sm">
                          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="h-5 w-5 shrink-0 accent-primary" />
                          Aceito receber novidades e promoções da barbearia
                        </label>
                      </div>
                      <Button type="submit" className="h-12 w-full text-base" disabled={book.isPending || loading}>
                        {book.isPending ? "Confirmando…" : session ? "Confirmar reserva" : "Entrar para confirmar"}
                      </Button>
                    </div>
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
        next={afterLogin}
        notice={CALLBACK_NOTICES[new URLSearchParams(location.search).get("erro") as CallbackError] ?? null}
        onViewChange={openAuth}
        onClose={closeAuth}
        client
        shopName={data?.nome}
        shopLogo={view?.logoUrl}
      />
    </div>
  )
}
