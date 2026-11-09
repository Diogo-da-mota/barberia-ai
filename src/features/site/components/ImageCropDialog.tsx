import { useEffect, useRef, useState } from "react"
import { Button } from "@/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog"
import { cn } from "@/lib/utils"
import { BRAND_IMAGES, cropGeometry, type BrandKind } from "../crop"
import { MAX_IMAGE_BYTES } from "../domain"

const STEP = 12

export type CropSpec = { label: string; aspect: number; width: number; height: number; ratio: string; mime: string }

/** Recortar e dimensionar logo/capa: arraste para posicionar, use o zoom e confirme. O arquivo sai já no tamanho final. */
export function ImageCropDialog({ file, kind, onCancel, onConfirm }: { file: File | null; kind: BrandKind; onCancel: () => void; onConfirm: (cropped: File) => void }) {
  return (
    <Dialog open={Boolean(file)} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-2rem)] max-w-[600px] overflow-y-auto bg-card">
        {file && <Cropper key={`${file.name}-${file.size}-${file.lastModified}`} file={file} kind={kind} onCancel={onCancel} onConfirm={onConfirm} />}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Editor de recorte. No pop-up (`ImageCropDialog`) ou EMBUTIDO na tela (`inline`): neste caso, `onLive` recebe a cada ajuste uma URL
 * temporária do recorte, para o site mostrar a mudança na pré-visualização antes de confirmar. `spec` e `round` permitem recortar
 * para a proporção e o formato que o modelo de site escolhido usa.
 */
export function Cropper({ file, kind, spec: specProp, round = false, inline = false, onLive, onCancel, onConfirm }: { file: File; kind: BrandKind; spec?: CropSpec; round?: boolean; inline?: boolean; onLive?: (url: string | null) => void; onCancel: () => void; onConfirm: (cropped: File) => void }) {
  const spec: CropSpec = specProp ?? BRAND_IMAGES[kind]
  const liveRef = useRef(onLive)
  useEffect(() => { liveRef.current = onLive })
  const lastLive = useRef<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    let stale = false // o StrictMode (e trocar de arquivo) roda o efeito duas vezes: callbacks de uma execução antiga não valem
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    setFailed(false)
    const image = new Image()
    image.onload = () => { if (!stale) setImg(image) }
    image.onerror = () => { if (!stale) setFailed(true) }
    image.src = objectUrl
    return () => { stale = true; URL.revokeObjectURL(objectUrl) }
  }, [file])

  useEffect(() => {
    const element = frame.current
    if (!element) return
    const measure = () => { const r = element.getBoundingClientRect(); setBox({ w: r.width, h: r.height }) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const ready = Boolean(img && box.w > 0 && box.h > 0)
  const geo = ready ? cropGeometry({ imgW: img!.naturalWidth, imgH: img!.naturalHeight, boxW: box.w, boxH: box.h, zoom, offX: off.x, offY: off.y }) : null

  const gsx = geo?.sx, gsy = geo?.sy, gsw = geo?.sw, gsh = geo?.sh
  useEffect(() => {
    if (!liveRef.current || !img || gsx === undefined || gsy === undefined || gsw === undefined || gsh === undefined) return
    const timer = setTimeout(() => {
      const scale = 900 / Math.max(spec.width, spec.height)
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(spec.width * scale)
      canvas.height = Math.round(spec.height * scale)
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.drawImage(img, gsx, gsy, gsw, gsh, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (!blob) return
        const next = URL.createObjectURL(blob)
        const old = lastLive.current
        lastLive.current = next
        liveRef.current?.(next)
        if (old) setTimeout(() => URL.revokeObjectURL(old), 1500)
      }, "image/jpeg", 0.8)
    }, 120)
    return () => clearTimeout(timer)
  }, [img, gsx, gsy, gsw, gsh, spec.width, spec.height])
  useEffect(() => () => {
    liveRef.current?.(null)
    if (lastLive.current) URL.revokeObjectURL(lastLive.current)
  }, [])

  const move = (dx: number, dy: number) => setOff((current) => ({ x: current.x + dx, y: current.y + dy }))

  const confirm = async () => {
    if (!img || !geo) return
    setSaving(true)
    setError(null)
    try {
      const canvas = document.createElement("canvas")
      canvas.width = spec.width
      canvas.height = spec.height
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("canvas")
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(img, geo.sx, geo.sy, geo.sw, geo.sh, 0, 0, spec.width, spec.height)
      let blob: Blob | null = null
      for (const quality of [0.92, 0.8, 0.65]) {
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, spec.mime, quality))
        if (blob && blob.size <= MAX_IMAGE_BYTES) break
      }
      if (!blob || blob.size > MAX_IMAGE_BYTES) throw new Error("size")
      onConfirm(new File([blob], `${kind}.${spec.mime === "image/png" ? "png" : "jpg"}`, { type: spec.mime }))
    } catch {
      setError("Não foi possível recortar esta imagem. Tente outra.")
      setSaving(false)
    }
  }

  return (
    <>
      {inline ? (
        <div className="flex flex-col gap-1 text-left">
          <h3 className="font-display text-lg font-bold tracking-wide">Ajustar {spec.label.toLowerCase()}</h3>
          <p className="text-[13px] text-muted-foreground">Arraste para posicionar e use o zoom: a pré-visualização muda junto. Formato {spec.ratio}{round ? " (aparece redondo)" : ""}.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 pr-8 text-left">
          <DialogTitle className="font-display text-2xl font-bold tracking-wide">Ajustar {spec.label.toLowerCase()}</DialogTitle>
          <DialogDescription>Arraste para posicionar e use o zoom. A imagem final fica em {spec.ratio} ({spec.width} × {spec.height} px) e é assim que aparece no site.</DialogDescription>
        </div>
      )}

      <div
        ref={frame}
        role="group"
        tabIndex={0}
        aria-label={`Área de recorte da ${spec.label.toLowerCase()}. Arraste ou use as setas para mover.`}
        style={{ aspectRatio: String(spec.aspect) }}
        className={cn("relative mx-auto w-full cursor-grab touch-none select-none overflow-hidden border border-border bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing", round ? "rounded-full" : "rounded-md", spec.aspect === 1 && "max-w-[340px]", spec.aspect < 1 && "max-w-[280px]")}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: geo?.offX ?? 0, oy: geo?.offY ?? 0 } }}
        onPointerMove={(e) => { if (drag.current) setOff({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y }) }}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        onKeyDown={(e) => {
          const d = { ArrowLeft: [STEP, 0], ArrowRight: [-STEP, 0], ArrowUp: [0, STEP], ArrowDown: [0, -STEP] }[e.key]
          if (d) { e.preventDefault(); move(d[0], d[1]) }
        }}
      >
        {url && geo && img && (
          <img
            src={url} alt="" draggable={false}
            style={{ width: geo.dw, height: geo.dh, left: box.w / 2 - geo.dw / 2 + geo.offX, top: box.h / 2 - geo.dh / 2 + geo.offY, maxWidth: "none" }}
            className="pointer-events-none absolute"
          />
        )}
        {failed && <p role="alert" className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-danger">Não foi possível abrir esta imagem.</p>}
        {!img && !failed && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Carregando…</p>}
      </div>

      <label className="flex items-center gap-3 text-sm font-medium">
        Zoom
        <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" className="h-11 flex-1 accent-primary md:h-8" />
      </label>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" className="h-11 md:h-10" onClick={onCancel}>Cancelar</Button>
        <Button className="h-11 md:h-10" disabled={!ready || saving} onClick={() => void confirm()}>{saving ? "Recortando…" : inline ? "Aplicar" : "Usar esta imagem"}</Button>
      </div>
    </>
  )
}
