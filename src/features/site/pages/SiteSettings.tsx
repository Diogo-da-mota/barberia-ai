import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Copy, ExternalLink, Image as ImageIcon, Layers, Link2, Monitor, Palette, Pencil, Plus, Tag, Trash2, X, type LucideIcon } from "lucide-react"
import { CatalogFrame, ShopGate } from "@/features/catalog/components/CatalogFrame"
import { fetchProfessionals, fetchServices } from "@/features/catalog/api"
import { useActiveBarbershop } from "@/features/catalog/hooks/useActiveBarbershop"
import { getPublicShop } from "@/features/booking/api"
import { isMissingSchema } from "@/features/booking/domain"
import type { MyBarbershop } from "@/features/home/domain"
import { cn } from "@/lib/utils"
import { AccentPicker } from "@/ui/accent-picker"
import { Button } from "@/ui/button"
import { EmptyState } from "@/ui/finance"
import { Input } from "@/ui/input"
import { Skeleton } from "@/ui/skeleton"
import { toast } from "@/ui/sonner"
import { fetchMedia, fetchSiteProfile, publicMediaUrl, removeMedia, saveSiteProfile, saveSiteTemplate, setShopSlug, uploadMedia, type MediaRow, type SiteProfile } from "../api"
import { Cropper, type CropSpec } from "../components/ImageCropDialog"
import { BRAND_IMAGES, MAX_SOURCE_BYTES, type BrandKind } from "../crop"
import { MAX_GALLERY, isAccent, siteErrorMessage, validateImage, type AccentKey, type MediaKind } from "../domain"
import { SitePreview } from "../editor/SitePreview"
import { TemplateGallery } from "../editor/TemplateGallery"
import { DEFAULT_TEMPLATE, TEMPLATE_INFO, isTemplateId, type TemplateId } from "../templates"
import { TEMPLATE_SLOTS, capaSize } from "../templates/slots"
import { buildSiteView } from "../templates/view"
import { isReservedSlug, shopPath, shopUrl } from "@/lib/shopPaths"

const FIELD = "h-11 text-base md:h-10 md:text-sm"
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function SiteSettings() {
  const gate = useActiveBarbershop()
  const shop = gate.state === "ready" ? gate.active : null
  const header = (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 text-primary"><Monitor className="h-7 w-7" /></span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-wide sm:text-[28px]">Meu site</h1>
          <p className="text-sm text-muted-foreground">Monte a página pública da sua barbearia com um template profissional.</p>
        </div>
      </div>
      {shop && shop.status === "ativo" && (
        <Button asChild variant="outline" className="h-11 gap-2 md:h-10">
          <a href={shopPath(shop.slug)} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" className="h-4 w-4" />Ver site publicado</a>
        </Button>
      )}
    </header>
  )
  return (
    <CatalogFrame full title="Meu site" description="Monte a página pública da sua barbearia com um template profissional." header={header}>
      <ShopGate gate={gate}>
        {(active, canManage) =>
          canManage ? <Editor shop={active} /> : <div className="rounded-card border border-border bg-card"><EmptyState title="Área da gestão" description="Só o proprietário e o gerente editam o site." /></div>
        }
      </ShopGate>
    </CatalogFrame>
  )
}

function Editor({ shop }: { shop: MyBarbershop }) {
  const profile = useQuery({ queryKey: ["site-profile", shop.id], queryFn: () => fetchSiteProfile(shop.id) })
  const media = useQuery({ queryKey: ["site-media", shop.id], queryFn: () => fetchMedia(shop.id) })

  if (profile.isError || media.isError) {
    const error = profile.error ?? media.error
    if (isMissingSchema(error)) return <EmptyState title="Site indisponível" description="Este módulo ainda está sendo preparado no banco de dados." />
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm font-semibold">Não foi possível carregar o site</p>
        <Button variant="outline" className="h-11 md:h-10" onClick={() => { void profile.refetch(); void media.refetch() }}>Tentar novamente</Button>
      </div>
    )
  }
  if (!profile.data || !media.data) {
    return (
      <div role="status" aria-label="Carregando o site" className="grid gap-5 lg:grid-cols-[minmax(320px,28%)_minmax(0,1fr)]">
        <Skeleton className="h-[560px] w-full rounded-card" /><Skeleton className="h-[560px] w-full rounded-card" />
      </div>
    )
  }
  return <Workspace shop={shop} profile={profile.data} items={media.data} />
}

function Block({ icon: Icon, title, hint, children }: { icon: LucideIcon; title: string; hint: string; children: ReactNode }) {
  const id = `blk-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-b border-border px-4 py-5 last:border-b-0 sm:px-5">
      <header className="flex items-start gap-3">
        <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 id={id} className="font-display text-base leading-tight font-bold tracking-wide">{title}</h2>
          <p className="text-[13px] text-muted-foreground">{hint}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

function Workspace({ shop, profile, items }: { shop: MyBarbershop; profile: SiteProfile; items: MediaRow[] }) {
  const queryClient = useQueryClient()
  const owner = shop.papel === "proprietario"
  const templateSupported = profile.template !== undefined
  const savedTemplate: TemplateId = isTemplateId(profile.template) ? profile.template : DEFAULT_TEMPLATE

  // Rascunho: o que o usuário mexeu e ainda não salvou. A prévia usa o rascunho; o site publicado só muda ao salvar.
  const [template, setTemplate] = useState<TemplateId>(savedTemplate)
  const [descricao, setDescricao] = useState(profile.descricao ?? "")
  const [slug, setSlug] = useState(profile.slug)
  const [cor, setCor] = useState<AccentKey | null>(isAccent(profile.cor_destaque) ? profile.cor_destaque : null)
  const [error, setError] = useState<string | null>(null)

  const services = useQuery({ queryKey: ["services", shop.id], queryFn: () => fetchServices(shop.id) })
  const team = useQuery({ queryKey: ["professionals", shop.id], queryFn: () => fetchProfessionals(shop.id) })
  const gallery = items.filter((i) => i.kind === "galeria")
  // recorte em andamento (logo/capa): URLs temporárias que a prévia mostra antes de aplicar
  const [live, setLive] = useState<{ logo: string | null; capa: string | null }>({ logo: null, capa: null })
  const baseSource = {
    nome: shop.nome, descricao, endereco: profile.endereco, telefone: profile.telefone,
    logoPath: items.find((i) => i.kind === "logo")?.storage_path, capaPath: items.find((i) => i.kind === "capa")?.storage_path,
    galeria: gallery.map((g) => g.storage_path),
    services: services.data?.status === "ok" ? services.data.data.filter((s) => s.ativo) : [],
    professionals: team.data?.status === "ok" ? team.data.data.filter((p) => p.ativo) : [],
  }
  // `view` (com o recorte ao vivo) alimenta a prévia grande; `thumbView` (só o salvo) alimenta as 5 miniaturas, que não precisam redesenhar a cada arrasto
  const thumbView = useMemo(() => buildSiteView(baseSource), [shop.nome, descricao, profile.endereco, profile.telefone, items, gallery, services.data, team.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const view = useMemo(() => (live.logo || live.capa ? buildSiteView({ ...baseSource, logoUrlOverride: live.logo, capaUrlOverride: live.capa }) : thumbView), [thumbView, live]) // eslint-disable-line react-hooks/exhaustive-deps

  const descChanged = descricao.trim() !== (profile.descricao ?? "").trim()
  const templateChanged = template !== savedTemplate
  const slugChanged = slug !== profile.slug
  const dirty = descChanged || (templateChanged && templateSupported) || (slugChanged && owner)

  const slugProblem = !SLUG_RE.test(slug) || slug.length < 3 || slug.length > 60 ? siteErrorMessage({ message: "invalid_slug" }) : isReservedSlug(slug) ? siteErrorMessage({ message: "slug_reserved" }) : null
  // Disponibilidade (melhor esforço): a página pública já existe para este endereço? O servidor decide de verdade ao salvar.
  const [debounced, setDebounced] = useState(slug)
  useEffect(() => { const t = setTimeout(() => setDebounced(slug), 400); return () => clearTimeout(t) }, [slug])
  const check = useQuery({ queryKey: ["slug-check", debounced], queryFn: () => getPublicShop(debounced), enabled: owner && slugChanged && !slugProblem && debounced === slug })
  const taken = Boolean(check.data)

  const save = useMutation({
    mutationFn: async () => {
      if (descChanged) await saveSiteProfile({ shopId: shop.id, descricao, cor: isAccent(profile.cor_destaque) ? profile.cor_destaque : null, endereco: profile.endereco ?? "", telefone: profile.telefone ?? "" })
      if (templateChanged && templateSupported) await saveSiteTemplate(shop.id, template)
      if (slugChanged && owner) await setShopSlug(shop.id, slug)
    },
    onSuccess: async () => {
      setError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["site-profile", shop.id] }), queryClient.invalidateQueries({ queryKey: ["my-barbershops"] }), queryClient.invalidateQueries({ queryKey: ["public-shop"] }),
      ])
      toast.success(slugChanged ? "Site atualizado. O endereço antigo deixa de funcionar." : "Site atualizado.")
    },
    onError: async (e) => {
      setError(siteErrorMessage(e))
      await queryClient.invalidateQueries({ queryKey: ["site-profile", shop.id] }) // o que já foi gravado antes do erro aparece como salvo
    },
  })
  // clicar na cor já troca o site (AccentPicker); aqui só se guarda a cor da página pública da barbearia
  const saveColor = useMutation({
    mutationFn: (next: AccentKey | null) => saveSiteProfile({ shopId: shop.id, descricao: profile.descricao ?? "", cor: next, endereco: profile.endereco ?? "", telefone: profile.telefone ?? "" }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["site-profile", shop.id] }), queryClient.invalidateQueries({ queryKey: ["public-shop"] })]); toast.success("Cor atualizada.") },
    onError: (e) => setError(siteErrorMessage(e)),
  })

  const onSave = () => {
    if (descricao.length > 500) { setError("A descrição aceita até 500 caracteres."); return }
    if (slugChanged && owner && slugProblem) { setError(slugProblem); return }
    if (slugChanged && owner && taken) { setError(siteErrorMessage({ message: "slug_taken" })); return }
    setError(null)
    save.mutate()
  }

  const [copied, setCopied] = useState(false)
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shopUrl(profile.slug))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Não foi possível copiar. Selecione o endereço e copie manualmente.")
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(320px,28%)_minmax(0,1fr)] lg:items-stretch">
      <div className="flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-card">
        <Block icon={Layers} title="Template" hint="Escolha o visual do seu site público.">
          <div className={cn("flex items-center gap-3 rounded-xl border p-2.5", templateChanged ? "border-warning/40 bg-warning/5" : "border-primary/60 bg-primary/[0.06]")}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary/15 font-display text-lg font-bold text-primary">{TEMPLATE_INFO[template].nome.charAt(0)}</span>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-display text-lg leading-none font-bold tracking-wide">{TEMPLATE_INFO[template].nome}</span>
              <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", templateChanged ? "bg-warning/15 text-warning" : "bg-primary/15 text-primary")}>{templateChanged ? "Selecionado, não salvo" : "Selecionado"}</span>
            </span>
          </div>
          {!templateSupported && <p role="status" className="text-[13px] text-warning">A troca de template só pode ser salva depois que a migration 0011 for aplicada no banco. Por enquanto você pode visualizar os cinco modelos.</p>}
        </Block>

        <Block icon={Tag} title="Marca" hint="Logo, capa e descrição.">
          <Branding shop={shop} items={items} descricao={descricao} setDescricao={setDescricao} template={template} onLive={(kind, url) => setLive((cur) => ({ ...cur, [kind]: url }))} />
        </Block>

        <Block icon={ImageIcon} title="Galeria de fotos" hint={`Mostre o ambiente da sua barbearia (até ${MAX_GALLERY} fotos).`}>
          <GalleryEditor shop={shop} items={gallery} />
        </Block>

        <Block icon={Palette} title="Cores do site" hint="Defina a cor principal do seu site.">
          <AccentPicker variant="bolinhas" onPick={(choice) => { const next = isAccent(choice) ? choice : null; setCor(next); saveColor.mutate(next) }} />
          <p className="text-[13px] text-muted-foreground">Muda na hora a prévia e o painel e fica salva na barbearia: vale para todos os modelos.</p>
        </Block>

        <Block icon={Link2} title="Endereço do site" hint="O link que você divulga aos clientes.">
          <div className="flex flex-col gap-2">
            <div className="flex overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-primary">
              <Input aria-label="Endereço da página" value={slug} disabled={!owner} onChange={(e) => setSlug(e.target.value.toLowerCase())} aria-invalid={slugChanged && Boolean(slugProblem || taken) ? true : undefined}
                className={cn(FIELD, "min-w-0 flex-1 rounded-none border-0 shadow-none focus-visible:ring-0")} />
              <button type="button" onClick={() => void copyLink()} aria-label="Copiar link do site" title="Copiar link" className="grid w-11 shrink-0 place-items-center border-l border-border text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                {copied ? <Check aria-hidden="true" className="h-4 w-4 text-income" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[13px] break-all text-muted-foreground">Link: {shopUrl(profile.slug)}</p>
            {copied && <p role="status" className="text-[13px] text-income">Link copiado.</p>}
            {!owner && <p className="text-[13px] text-muted-foreground">Só o proprietário altera o endereço.</p>}
            {owner && slugChanged && (slugProblem ? <p role="alert" className="text-[13px] text-expense">{slugProblem}</p>
              : check.isFetching ? <p role="status" className="text-[13px] text-muted-foreground">Verificando disponibilidade…</p>
              : taken ? <p role="alert" className="text-[13px] text-expense">Este link já está em uso. Escolha outro.</p>
              : check.isSuccess ? <p role="status" className="text-[13px] text-income">Link disponível. Ao salvar, o endereço antigo deixa de funcionar.</p> : null)}
          </div>
        </Block>

        <div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-border bg-card p-4 sm:p-5">
          {error && <p role="alert" className="text-sm text-expense">{error}</p>}
          <Button type="button" onClick={onSave} disabled={!dirty || save.isPending} className="h-12 w-full gap-2 text-base">
            {save.isPending ? "Salvando…" : dirty ? <><Check aria-hidden="true" className="h-4 w-4" />Salvar alterações</> : <><Check aria-hidden="true" className="h-4 w-4" />Tudo salvo</>}
          </Button>
          {dirty && !save.isPending && <p className="text-center text-xs text-muted-foreground">Há alterações que ainda não aparecem no site publicado.</p>}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <section aria-labelledby="escolha-template" className="flex flex-col gap-3">
          <div>
            <h2 id="escolha-template" className="font-display text-2xl font-bold tracking-wide">Escolha um template</h2>
            <p className="text-sm text-muted-foreground">Todos usam os mesmos dados e o mesmo agendamento; muda só a apresentação.</p>
          </div>
          <TemplateGallery view={thumbView} accent={cor} selected={template} saved={savedTemplate} onSelect={setTemplate} />
        </section>
        <SitePreview view={view} accent={cor} template={template} unsaved={templateChanged || descChanged} />
        {shop.status !== "ativo" && <p role="status" className="text-sm text-warning">Sua barbearia está inativa: o site não aparece para os clientes.</p>}
      </div>
    </div>
  )
}

function useMediaActions(shopId: string, onBrandFile?: (kind: "logo" | "capa", file: File) => void) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["site-media", shopId] }), queryClient.invalidateQueries({ queryKey: ["public-shop"] })])
  const upload = useMutation({
    mutationFn: ({ kind, file }: { kind: MediaKind; file: File }) => uploadMedia(shopId, kind, file),
    onSuccess: async () => { setError(null); await refresh(); toast.success("Imagem enviada.") },
    onError: (e) => setError(siteErrorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: removeMedia,
    onSuccess: async () => { await refresh(); toast.success("Imagem removida.") },
    onError: (e) => setError(siteErrorMessage(e)),
  })
  const pick = (kind: MediaKind) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    const brand = kind === "logo" || kind === "capa"
    const problem = validateImage(file, brand ? MAX_SOURCE_BYTES : undefined)
    if (problem) { setError(problem); return }
    setError(null)
    // logo e capa passam pelo ajuste (recorte para o modelo escolhido); a galeria envia direto
    if (brand) { onBrandFile?.(kind, file); return }
    upload.mutate({ kind, file })
  }
  const feedback = (
    <>
      {upload.isPending && <p role="status" className="text-sm text-muted-foreground">Enviando imagem…</p>}
      {error && <p role="alert" className="text-sm text-expense">{error}</p>}
    </>
  )
  return { upload, remove, pick, feedback, setError }
}

const overlayBtn = "grid h-9 w-9 place-items-center rounded-lg bg-black/70 text-white transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"

function BrandTile({ kind, label, item, busy, onPick, onRemove, onAdjust, active, className }: { kind: "logo" | "capa"; label: string; item: MediaRow | undefined; busy: boolean; onPick: (e: ChangeEvent<HTMLInputElement>) => void; onRemove: (id: string) => void; onAdjust: () => void; active: boolean; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl border bg-surface-alt", active ? "border-primary ring-2 ring-primary/40" : "border-border", className)}>
      {item ? <img src={publicMediaUrl(item.storage_path) ?? ""} alt={label} className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-muted-foreground">Sem {label.toLowerCase()}</span>}
      {/* clicar na imagem abre o ajuste (tamanho e posição) da imagem atual */}
      {item && <button type="button" onClick={onAdjust} aria-label={`Ajustar ${label.toLowerCase()}`} title={`Ajustar ${label.toLowerCase()}`} className="absolute inset-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" />}
      <label className={cn(overlayBtn, "absolute right-2 bottom-2 cursor-pointer focus-within:ring-2 focus-within:ring-primary")} title={item ? `Trocar ${label}` : `Enviar ${label}`}>
        <Pencil aria-hidden="true" className="h-4 w-4" /><span className="sr-only">{item ? "Trocar" : "Enviar"} {label}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onPick} disabled={busy} data-kind={kind} />
      </label>
      {item && <button type="button" aria-label={`Remover ${label}`} title={`Remover ${label}`} className={cn(overlayBtn, "absolute top-2 right-2")} onClick={() => onRemove(item.id)}><Trash2 aria-hidden="true" className="h-4 w-4" /></button>}
    </div>
  )
}

function Branding({ shop, items, descricao, setDescricao, template, onLive }: { shop: MyBarbershop; items: MediaRow[]; descricao: string; setDescricao: (v: string) => void; template: TemplateId; onLive: (kind: BrandKind, url: string | null) => void }) {
  const [adjusting, setAdjusting] = useState<{ kind: BrandKind; file: File } | null>(null)
  const [opening, setOpening] = useState<BrandKind | null>(null)
  const { upload, remove, pick, feedback, setError } = useMediaActions(shop.id, (kind, file) => setAdjusting({ kind, file }))
  const busy = upload.isPending || remove.isPending
  const slot = TEMPLATE_SLOTS[template]
  // o recorte segue o modelo escolhido: cada um usa a capa num formato (e a logo quadrada ou redonda)
  const capaSpec: CropSpec = { label: "Capa", aspect: slot.capaAspect, ratio: slot.capaRatio, mime: "image/jpeg", ...capaSize(slot.capaAspect) }
  const specFor = (kind: BrandKind): CropSpec => (kind === "capa" ? capaSpec : BRAND_IMAGES.logo)

  const adjustCurrent = async (kind: BrandKind) => {
    const item = items.find((i) => i.kind === kind)
    const url = publicMediaUrl(item?.storage_path)
    if (!url) return
    setOpening(kind)
    setError(null)
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error("fetch")
      const blob = await response.blob()
      setAdjusting({ kind, file: new File([blob], `${kind}-atual`, { type: blob.type || "image/jpeg" }) })
    } catch {
      setError("Não foi possível abrir a imagem atual para ajustar. Use o lápis para enviar a imagem de novo.")
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
        <BrandTile kind="logo" label="Logo" item={items.find((i) => i.kind === "logo")} busy={busy} onPick={pick("logo")} onRemove={(id) => remove.mutate(id)} onAdjust={() => void adjustCurrent("logo")} active={adjusting?.kind === "logo"} className="aspect-square" />
        <BrandTile kind="capa" label="Capa" item={items.find((i) => i.kind === "capa")} busy={busy} onPick={pick("capa")} onRemove={(id) => remove.mutate(id)} onAdjust={() => void adjustCurrent("capa")} active={adjusting?.kind === "capa"} className="min-h-24" />
      </div>
      {opening && <p role="status" className="text-sm text-muted-foreground">Abrindo {opening === "logo" ? "a logo" : "a capa"}…</p>}
      {adjusting ? (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/[0.04] p-3">
          <Cropper
            key={`${adjusting.kind}-${adjusting.file.name}-${adjusting.file.size}-${template}`} inline
            file={adjusting.file} kind={adjusting.kind} spec={specFor(adjusting.kind)} round={adjusting.kind === "logo" && slot.logoRound}
            onLive={(url) => onLive(adjusting.kind, url)}
            onCancel={() => setAdjusting(null)}
            onConfirm={(cropped) => { upload.mutate({ kind: adjusting.kind, file: cropped }); setAdjusting(null) }}
          />
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Clique na imagem para ajustar tamanho e posição; o lápis troca o arquivo. No template {TEMPLATE_INFO[template].nome} a capa fica em {slot.capaRatio} ({slot.capaUse}) e a logo {slot.logoRound ? "aparece redonda" : "aparece quadrada"}. JPEG, PNG ou WebP.
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="site-desc" className="text-sm font-medium">Descrição</label>
        <textarea id="site-desc" value={descricao} maxLength={500} rows={3} onChange={(e) => setDescricao(e.target.value)}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
        <p className="text-[13px] text-muted-foreground">{descricao.length}/500 · aparece na página e nos resultados de busca.</p>
      </div>
      {feedback}
    </div>
  )
}

function GalleryEditor({ shop, items }: { shop: MyBarbershop; items: MediaRow[] }) {
  const { upload, remove, pick, feedback } = useMediaActions(shop.id)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">Fotos ({items.length}/{MAX_GALLERY})</p>
      <ul className="grid grid-cols-4 gap-2.5">
        {items.map((g, index) => (
          <li key={g.id} className="relative aspect-square overflow-hidden rounded-xl border border-border bg-surface-alt">
            <img src={publicMediaUrl(g.storage_path) ?? ""} alt={`Foto ${index + 1} da galeria`} loading="lazy" className="h-full w-full object-cover" />
            <button type="button" aria-label={`Remover foto ${index + 1}`} title={`Remover foto ${index + 1}`} disabled={remove.isPending} onClick={() => remove.mutate(g.id)}
              className="absolute top-1 right-1 grid h-7 w-7 place-items-center rounded-md bg-black/70 text-white transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
          </li>
        ))}
        {items.length < MAX_GALLERY && (
          <li className="aspect-square">
            <label className="flex h-full w-full cursor-pointer items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-within:ring-2 focus-within:ring-primary" title="Adicionar foto à galeria">
              <Plus aria-hidden="true" className="h-6 w-6" /><span className="sr-only">Adicionar foto à galeria</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pick("galeria")} disabled={upload.isPending} />
            </label>
          </li>
        )}
      </ul>
      {feedback}
    </div>
  )
}
