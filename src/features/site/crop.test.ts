import { describe, expect, it } from "vitest"
import { BRAND_IMAGES, cropGeometry } from "./crop"

const base = { imgW: 2000, imgH: 1000, boxW: 600, boxH: 200, zoom: 1, offX: 0, offY: 0 }

describe("recorte de logo e capa", () => {
  it("medidas fixas: logo 1:1 (512×512) e capa 3:1 (1800×600), no mesmo formato da moldura", () => {
    expect(BRAND_IMAGES.logo).toMatchObject({ aspect: 1, width: 512, height: 512 })
    expect(BRAND_IMAGES.capa).toMatchObject({ aspect: 3, width: 1800, height: 600 })
    expect(BRAND_IMAGES.capa.width / BRAND_IMAGES.capa.height).toBe(BRAND_IMAGES.capa.aspect)
  })

  it("zoom 1 cobre a moldura sem sobra e centraliza a área recortada", () => {
    const g = cropGeometry(base) // 2:1 numa moldura 3:1 → ajusta pela largura
    expect(g.dw).toBeCloseTo(600)
    expect(g.sw).toBeCloseTo(2000)
    expect(g.sx).toBeCloseTo(0)
    expect(g.sh / g.sw).toBeCloseTo(200 / 600) // a área tem o formato da moldura
  })

  it("a área recortada sempre mantém o formato da moldura, com qualquer zoom", () => {
    for (const zoom of [1, 1.7, 3, 4]) {
      const g = cropGeometry({ ...base, zoom })
      expect(g.sw / g.sh).toBeCloseTo(3)
    }
  })

  it("não deixa arrastar além da borda da imagem (nunca aparece vazio)", () => {
    const g = cropGeometry({ ...base, zoom: 2, offX: 99999, offY: -99999 })
    expect(g.offX).toBeCloseTo(g.maxX)
    expect(g.offY).toBeCloseTo(-g.maxY)
    expect(g.sx).toBeGreaterThanOrEqual(-0.001)
    expect(g.sy).toBeGreaterThanOrEqual(-0.001)
    expect(g.sx + g.sw).toBeLessThanOrEqual(2000.001)
    expect(g.sy + g.sh).toBeLessThanOrEqual(1000.001)
  })

  it("arrastar para a direita mostra a parte esquerda da imagem (e vice-versa)", () => {
    const centro = cropGeometry({ ...base, zoom: 2 })
    expect(cropGeometry({ ...base, zoom: 2, offX: 50 }).sx).toBeLessThan(centro.sx)
    expect(cropGeometry({ ...base, zoom: 2, offX: -50 }).sx).toBeGreaterThan(centro.sx)
  })

  it("imagem vertical (1080×1920) na moldura da capa: ajusta pela largura e deixa escolher a faixa", () => {
    const g = cropGeometry({ imgW: 1080, imgH: 1920, boxW: 900, boxH: 300, zoom: 1, offX: 0, offY: 0 })
    expect(g.sw).toBeCloseTo(1080)
    expect(g.sh).toBeCloseTo(360)
    expect(g.maxY).toBeGreaterThan(0)
    expect(cropGeometry({ imgW: 1080, imgH: 1920, boxW: 900, boxH: 300, zoom: 1, offX: 0, offY: 300 }).sy).toBeLessThan(g.sy)
  })
})
