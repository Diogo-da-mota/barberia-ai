import { useCallback, useEffect, useState } from "react"
import useEmblaCarousel from "embla-carousel-react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Carrossel de imagens no padrão shadcn/ui (embla). Setas nas laterais, arraste com o dedo
 * e pontinhos embaixo mostrando quantas fotos existem e qual está aberta.
 */
export function ImageCarousel({ images, alt, className, slideClassName, fill = false }: { images: string[]; alt: string; className?: string; slideClassName?: string; fill?: boolean }) {
  const [ref, api] = useEmblaCarousel({ loop: images.length > 1 })
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!api) return
    const onSelect = () => setIndex(api.selectedScrollSnap())
    onSelect()
    api.on("select", onSelect)
    api.on("reInit", onSelect)
    return () => {
      api.off("select", onSelect)
      api.off("reInit", onSelect)
    }
  }, [api])

  const prev = useCallback(() => api?.scrollPrev(), [api])
  const next = useCallback(() => api?.scrollNext(), [api])
  const many = images.length > 1

  return (
    <div className={cn("relative flex flex-col items-center gap-1", fill && "h-full gap-0", className)} role="region" aria-roledescription="carrossel" aria-label={alt}>
      <div className={cn("relative w-full overflow-hidden bg-surface-alt", fill ? "h-full rounded-none" : "rounded-md")}>
        <div ref={ref} className={cn("overflow-hidden", fill && "h-full")}>
          <div className={cn("flex touch-pan-y", fill && "h-full")}>
            {images.map((src, i) => (
              <div key={`${src}-${i}`} className={cn("min-w-0 flex-[0_0_100%]", fill && "h-full", slideClassName)} role="group" aria-roledescription="slide" aria-label={`${i + 1} de ${images.length}`}>
                <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        </div>
        {many && (
          <>
            <button type="button" onClick={prev} aria-label="Foto anterior" className="absolute top-1/2 left-1 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/70 text-foreground shadow-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={next} aria-label="Próxima foto" className="absolute top-1/2 right-1 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/70 text-foreground shadow-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      {many && (
        <div className={cn("flex items-center gap-1.5", fill && "absolute inset-x-0 bottom-1.5 justify-center")} aria-label={`Foto ${index + 1} de ${images.length}`}>
          {images.map((_, i) => (
            <span key={i} aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full transition-colors", i === index ? "bg-primary" : fill ? "bg-background/70" : "bg-muted-foreground/40")} />
          ))}
        </div>
      )}
    </div>
  )
}
