import { useEffect, useState, type ChangeEvent, type ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ImageUp, RotateCcw } from "lucide-react"
import { HeroPhoto, SidebarPhoto } from "@/app/PanelPhotos"
import { AuthPhoto } from "@/features/auth/components/AuthDialog"
import { FinanceHeader } from "@/features/finance/components/FinanceHeader"
import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/ui/button"
import { BannerPhoto, type BannerName } from "@/ui/page-banner"
import { toast } from "@/ui/sonner"
import { TabbedHeaderPhoto } from "@/ui/tabbed-header"
import { Tabs } from "@/ui/tabs"
import { removePanelPhoto, savePanelPhoto, type PanelPhoto } from "../api"
import { MAX_SOURCE_BYTES } from "../crop"
import { siteErrorMessage, validateImage } from "../domain"
import { ScaledFrame } from "../editor/ScaledFrame"
import { panelPhotosKey, usePanelPhoto } from "../hooks/usePanelPhoto"
import { useShopLogo } from "../hooks/useShopLogo"
import { Cropper, type CropSpec } from "./ImageCropDialog"

type Src = string | null | undefined

/**
 * Medidas reais (tela de 1440 px no computador e 390 px no celular):
 * - menu: 256 px de largura, foto em 60% da altura (tela de 900 px);
 * - topo do Início: área principal (tela menos a sidebar de 256 px) × 440 px;
 * - faixas: área de conteúdo (tela menos sidebar e margens do main, 24/16 px de cada lado), limitada pela largura da tela
 *   (Agendamentos 768 px, Serviços 1480 px), × 160 px no computador e 110 px no celular;
 * - Financeiro: o cabeçalho com abas de verdade na largura de conteúdo (a altura vem do próprio cabeçalho, até 160 px); a foto ocupa
 *   66% da largura à direita. No celular, 110 px de altura e a largura toda;
 * - login do cliente: lado esquerdo do pop-up no computador (480 × 640, foto com 12 px de margem). No celular o pop-up não tem foto.
 */
const MENU = { width: 256, height: 540 }
const HERO = { height: 440, desktop: 1440 - 256, phone: 390 }
const CONTENT = { desktop: 1440 - 256 - 48, phone: 390 - 32 }
const BANNER = { desktop: 160, phone: 110 }
const FINANCE = { photoWidth: Math.round((1440 - 256 - 48) * 0.66), photoHeight: 128 }
const LOGIN = { width: 480, height: 640, inset: 12 }

/** Moldura de prévia: tema escuro (onde as fotos aparecem), renderizada na medida real e reduzida para caber. */
function Frame({ label, aria, width, height, surface = "dark bg-background", children }: { label: string; aria: string; width: number; height: number; surface?: string; children: ReactNode }) {
  return (
    <figure className="flex w-full min-w-0 flex-col gap-1.5" style={{ maxWidth: width }}>
      <div role="img" aria-label={aria} className="overflow-hidden rounded-xl border border-border">
        <ScaledFrame width={width} height={height}>
          <div className={cn("relative isolate", surface)} style={{ width, height }}>{children}</div>
        </ScaledFrame>
      </div>
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  )
}

function MenuPreview({ src }: { src: Src }) {
  return (
    <div role="img" aria-label="Prévia da foto do menu lateral" className="dark relative mx-auto w-64 overflow-hidden rounded-xl border border-border bg-card" style={{ height: MENU.height }}>
      <SidebarPhoto src={src} />
    </div>
  )
}

function HeroPreview({ src }: { src: Src }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px] sm:items-start">
      <Frame label="Computador" aria="Prévia do topo do Início no computador" width={HERO.desktop} height={HERO.height}><HeroPhoto src={src} /></Frame>
      <Frame label="Celular" aria="Prévia do topo do Início no celular" width={HERO.phone} height={HERO.height}><HeroPhoto src={src} /></Frame>
    </div>
  )
}

function BannerPreview({ name, title, width, src }: { name: BannerName; title: string; width: number; src: Src }) {
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,358px)] xl:items-start">
      <Frame label="Computador" aria={`Prévia da faixa de ${title} no computador`} width={width} height={BANNER.desktop}><BannerPhoto name={name} src={src} /></Frame>
      <Frame label="Celular" aria={`Prévia da faixa de ${title} no celular`} width={CONTENT.phone} height={BANNER.phone}><BannerPhoto name={name} src={src} /></Frame>
    </div>
  )
}

function FinancePreview({ src }: { src: Src }) {
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,358px)] xl:items-start">
      {/* o próprio cabeçalho do Financeiro (aba Resumo, com o mês), como aparece para a gestão */}
      <Frame label="Computador" aria="Prévia do cabeçalho do Financeiro no computador" width={CONTENT.desktop} height={BANNER.desktop}>
        <Tabs value="resumo"><FinanceHeader tabs showMonth month={new Date().toISOString().slice(0, 7)} onMonth={() => {}} photo={src} /></Tabs>
      </Frame>
      <Frame label="Celular" aria="Prévia do cabeçalho do Financeiro no celular" width={CONTENT.phone} height={BANNER.phone}><TabbedHeaderPhoto src={src} phone /></Frame>
    </div>
  )
}

function LoginPreview({ src, shopId, shopName }: { src: Src; shopId: string; shopName: string }) {
  const logo = useShopLogo(shopId)
  return (
    <Frame label="Computador" aria="Prévia da foto do login do cliente" width={LOGIN.width} height={LOGIN.height} surface="bg-card">
      <AuthPhoto client shopName={shopName} shopLogo={logo} src={src ?? null} />
    </Frame>
  )
}

type Shop = { shopId: string; shopName: string }
type CardConfig = { photo: PanelPhoto; title: string; spec: CropSpec; preview: (src: Src, shop: Shop) => ReactNode }

const bannerCard = (photo: PanelPhoto & BannerName, title: string, maxWidth: number): CardConfig => {
  const width = Math.min(CONTENT.desktop, maxWidth)
  return {
    photo, title, preview: (src) => <BannerPreview name={photo} title={title} width={width} src={src} />,
    spec: { label: "Foto da faixa", aspect: width / BANNER.desktop, width: width * 2, height: BANNER.desktop * 2, ratio: `faixa (${width} × ${BANNER.desktop})`, mime: "image/jpeg" },
  }
}

// snip: um recorte por foto, na medida do computador; em outras larguras a foto se ajusta pelo centro (object-cover), como já era
/** Coluna estreita: as fotos verticais. */
const SIDE_CARDS: CardConfig[] = [
  {
    photo: "menu", title: "Menu lateral", preview: (src) => <MenuPreview src={src} />,
    spec: { label: "Foto do menu", aspect: MENU.width / MENU.height, width: 768, height: 1620, ratio: "vertical (256 × 540)", mime: "image/jpeg" },
  },
  {
    photo: "login", title: "Login do cliente", preview: (src, shop) => <LoginPreview src={src} {...shop} />,
    spec: { label: "Foto do login", aspect: (LOGIN.width - 2 * LOGIN.inset) / (LOGIN.height - 2 * LOGIN.inset), width: 912, height: 1232, ratio: "vertical (456 × 616)", mime: "image/jpeg" },
  },
]
/** Na ordem do menu do painel. */
const PAGE_CARDS: CardConfig[] = [
  {
    photo: "inicio", title: "Topo do Início", preview: (src) => <HeroPreview src={src} />,
    spec: { label: "Foto do topo", aspect: HERO.desktop / HERO.height, width: HERO.desktop * 2, height: HERO.height * 2, ratio: "horizontal (1184 × 440)", mime: "image/jpeg" },
  },
  bannerCard("agenda", "Agendamentos", 768),
  bannerCard("servicos", "Serviços", 1480),
  {
    photo: "financeiro", title: "Financeiro", preview: (src) => <FinancePreview src={src} />,
    spec: { label: "Foto do cabeçalho", aspect: FINANCE.photoWidth / FINANCE.photoHeight, width: FINANCE.photoWidth * 2, height: FINANCE.photoHeight * 2, ratio: `faixa (${FINANCE.photoWidth} × ${FINANCE.photoHeight})`, mime: "image/jpeg" },
  },
]

/** Meu site › Fotos: fotos do painel e do login do cliente (nada do site público). Verticais numa coluna estreita; as páginas ao lado. */
export function PanelPhotosEditor(shop: Shop) {
  return (
    <div className="grid gap-5 lg:grid-cols-[296px_minmax(0,1fr)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-5">{SIDE_CARDS.map((card) => <PhotoCard key={card.photo} shop={shop} {...card} />)}</div>
      <div className="flex min-w-0 flex-col gap-5">{PAGE_CARDS.map((card) => <PhotoCard key={card.photo} shop={shop} {...card} />)}</div>
    </div>
  )
}

function PhotoCard({ shop, photo, title, spec, preview }: CardConfig & { shop: Shop }) {
  const { shopId } = shop
  const queryClient = useQueryClient()
  const current = usePanelPhoto(shopId, photo)
  const [file, setFile] = useState<File | null>(null)
  const [live, setLive] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null) // recorte enviado: fica na prévia até a foto salva chegar
  const [error, setError] = useState<string | null>(null)
  useEffect(() => () => { if (sent) URL.revokeObjectURL(sent) }, [sent])

  const done = async (message: string) => {
    setError(null)
    await queryClient.invalidateQueries({ queryKey: panelPhotosKey(shopId) })
    setSent(null)
    toast.success(message)
  }
  const fail = (e: unknown) => { setSent(null); setError(siteErrorMessage(e)) }
  const save = useMutation({ mutationFn: (cropped: File) => savePanelPhoto(shopId, photo, cropped), onSuccess: () => done("Foto atualizada."), onError: fail })
  const restore = useMutation({ mutationFn: () => removePanelPhoto(shopId, photo), onSuccess: () => done("Foto padrão restaurada."), onError: fail })
  const busy = save.isPending || restore.isPending
  const custom = typeof current === "string"

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0]
    event.target.value = ""
    if (!picked) return
    const problem = validateImage(picked, MAX_SOURCE_BYTES)
    if (problem) { setError(problem); return }
    setError(null)
    setFile(picked)
  }

  const id = `foto-${photo}`
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id={id} className="font-display text-lg font-bold tracking-wide">{title}</h2>
          {current !== undefined && (
            <span role="status" className={cn("rounded-md px-2 py-0.5 text-xs font-medium", custom ? "bg-primary/15 text-primary" : "bg-surface-alt text-muted-foreground")}>{custom ? "Sua foto" : "Padrão"}</span>
          )}
        </div>
        {!file && (
          <div className="flex flex-wrap gap-2">
            <label className={cn(buttonVariants({ variant: "outline" }), "h-11 cursor-pointer gap-2 focus-within:ring-2 focus-within:ring-primary md:h-10", busy && "pointer-events-none opacity-50")}>
              <ImageUp aria-hidden="true" className="h-4 w-4" />Trocar foto
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pick} disabled={busy} />
            </label>
            {custom && (
              <Button type="button" variant="outline" aria-label="Restaurar foto padrão" title="Restaurar foto padrão" className="h-11 gap-2 md:h-10" disabled={busy} onClick={() => restore.mutate()}>
                <RotateCcw aria-hidden="true" className="h-4 w-4" />Restaurar
              </Button>
            )}
          </div>
        )}
      </header>

      {file && (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/[0.04] p-3">
          {/* `kind` só nomeia o arquivo recortado; o formato vem de `spec` */}
          <Cropper
            key={`${file.name}-${file.size}-${file.lastModified}`} inline file={file} kind="capa" spec={spec}
            onLive={setLive}
            onCancel={() => setFile(null)}
            onConfirm={(cropped) => { setSent(URL.createObjectURL(cropped)); save.mutate(cropped); setFile(null) }}
          />
        </div>
      )}

      {preview(live ?? sent ?? current, shop)}
      {save.isPending && <p role="status" className="text-sm text-muted-foreground">Enviando foto…</p>}
      {error && <p role="alert" className="text-sm text-expense">{error}</p>}
    </section>
  )
}
