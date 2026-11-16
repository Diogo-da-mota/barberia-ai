import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** Faixas fotográficas (WebP em `public/images`, fotos do Unsplash; créditos em `public/images/CREDITOS.md`). */
export const PAGE_BANNERS = {
  agenda: { src: "/images/banner-agenda.webp", position: "center 55%" },
  reservas: { src: "/images/banner-reservas.webp", position: "center 45%" },
  servicos: { src: "/images/banner-servicos.webp", position: "center 38%" },
} as const
export type BannerName = keyof typeof PAGE_BANNERS

/**
 * Faixa discreta com fotografia no topo de uma página: no máximo 110px no celular, 130px no tablet e 160px no desktop.
 * A foto se funde ao fundo por degradês (embaixo e nas laterais), sem borda. Só aparece no tema escuro; no claro,
 * só o conteúdo (`children`, normalmente o título) é mostrado. Decorativa: `children` é que carrega o texto.
 */
export function PageBanner({ name, photo, children, className }: { name: BannerName; /** Foto da barbearia (Meu site › Fotos): null = padrão; undefined = carregando. */ photo: string | null | undefined; children?: ReactNode; className?: string }) {
  return (
    <div data-banner={name} className={cn("relative isolate [.dark_&]:h-[110px] sm:[.dark_&]:h-[130px] lg:[.dark_&]:h-[160px]", className)}>
      <BannerPhoto name={name} src={photo} />
      {children && <div className="flex h-full flex-col justify-center">{children}</div>}
    </div>
  )
}

const MASK = "linear-gradient(to right, transparent, black 16%, black 84%, transparent)"

/**
 * Camada da foto da faixa, a MESMA na página e na prévia de Meu site › Fotos. As laterais somem por máscara; a base, por degradê
 * (a foto se funde ao preto da página). `src`: undefined = carregando (sem piscar a padrão), null = foto padrão.
 */
export function BannerPhoto({ name, src }: { name: BannerName; src: string | null | undefined }) {
  const { src: fallback, position } = PAGE_BANNERS[name]
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 hidden overflow-hidden [.dark_&]:block">
      {src !== undefined && <img src={src ?? fallback} alt="" decoding="async" className="h-full w-full object-cover opacity-90" style={{ objectPosition: position, maskImage: MASK, WebkitMaskImage: MASK }} />}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/45 to-background/5" />
    </div>
  )
}
