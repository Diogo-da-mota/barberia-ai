import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Mostra `children` numa tela LÓGICA de `width × height` px, reduzida para caber na largura disponível. O conteúdo é renderizado de verdade
 * nessa largura (por isso os modelos escolhem o layout de desktop, tablet ou celular), só que menor na tela.
 * Com `fill`, a altura é a do contêiner (que precisa ter altura própria). O conteúdo fica inerte (sem cliques, foco nem leitor de tela); com `scroll`, a moldura rola para ver o site inteiro.
 */
export function ScaledFrame({ width, height, fill = false, scroll = false, label, className, children }: { width: number; height: number; fill?: boolean; scroll?: boolean; label?: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(0)
  const [availableHeight, setAvailableHeight] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => { setAvailable(el.clientWidth); setAvailableHeight(el.clientHeight) }
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const scale = available > 0 ? Math.min(1, available / width) : 1
  // fill: a moldura ocupa toda a altura do contêiner (o conteúdo é renderizado na altura lógica equivalente)
  const shownHeight = fill && availableHeight > 0 ? availableHeight : height * scale
  const logicalHeight = fill && availableHeight > 0 ? availableHeight / scale : height
  return (
    <div ref={ref} className={cn("w-full", fill && "h-full", className)}>
      <div className="relative mx-auto overflow-hidden" style={{ width: width * scale, height: shownHeight }}>
        <div
          {...(scroll ? { tabIndex: 0, role: "region", "aria-label": label } : { "aria-hidden": true })}
          className="absolute top-0 left-0 origin-top-left focus-visible:outline-2 focus-visible:outline-primary"
          style={{ width, height: logicalHeight, transform: `scale(${scale})`, overflowY: scroll ? "auto" : "hidden", overflowX: "hidden" }}
        >
          <div inert>{children}</div>
        </div>
      </div>
    </div>
  )
}
