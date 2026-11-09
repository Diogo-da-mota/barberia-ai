/** Medidas finais das imagens da marca: o recorte do painel sai exatamente neste tamanho e o site só reproduz. */
export const BRAND_IMAGES = {
  logo: { label: "Logo", aspect: 1, width: 512, height: 512, ratio: "1:1", mime: "image/png" },
  capa: { label: "Capa", aspect: 3, width: 1800, height: 600, ratio: "3:1", mime: "image/jpeg" },
} as const
export type BrandKind = keyof typeof BRAND_IMAGES

/** Arquivo de origem aceito para recortar (o resultado recortado é que precisa caber em 2 MB). */
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024

export type CropInput = { imgW: number; imgH: number; boxW: number; boxH: number; zoom: number; offX: number; offY: number }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Geometria do recorte. A imagem cobre a moldura (zoom 1 = justa) e é deslocada a partir do centro; o deslocamento
 * é limitado para nunca deixar vazio. `sx/sy/sw/sh` é a área da imagem original que aparece na moldura.
 */
export function cropGeometry({ imgW, imgH, boxW, boxH, zoom, offX, offY }: CropInput) {
  const scale = Math.max(boxW / imgW, boxH / imgH) * zoom
  const dw = imgW * scale
  const dh = imgH * scale
  const maxX = Math.max(0, (dw - boxW) / 2)
  const maxY = Math.max(0, (dh - boxH) / 2)
  const x = clamp(offX, -maxX, maxX)
  const y = clamp(offY, -maxY, maxY)
  return {
    scale, dw, dh, maxX, maxY, offX: x, offY: y,
    sx: imgW / 2 - (boxW / 2 + x) / scale,
    sy: imgH / 2 - (boxH / 2 + y) / scale,
    sw: boxW / scale,
    sh: boxH / scale,
  }
}
