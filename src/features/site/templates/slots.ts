import type { TemplateId } from "./types"

/**
 * Como cada modelo usa a capa e a logo. O enquadramento de uma imagem depende do modelo: um hero lateral (Urbano) e um retrato
 * alto (Premium) pedem recortes bem diferentes de uma faixa larga (Minimalista). O editor recorta para o modelo SELECIONADO.
 */
export const TEMPLATE_SLOTS: Record<TemplateId, { capaAspect: number; capaRatio: string; capaUse: string; logoRound: boolean }> = {
  urbano: { capaAspect: 5 / 4, capaRatio: "5:4", capaUse: "painel ao lado do título", logoRound: false },
  classico: { capaAspect: 2, capaRatio: "2:1", capaUse: "faixa emoldurada no topo", logoRound: true },
  minimalista: { capaAspect: 21 / 9, capaRatio: "21:9", capaUse: "faixa larga abaixo do título", logoRound: false },
  moderno: { capaAspect: 2, capaRatio: "2:1", capaUse: "fundo da primeira tela", logoRound: true },
  premium: { capaAspect: 3 / 4, capaRatio: "3:4", capaUse: "retrato alto ao lado do título", logoRound: true },
}

/** Medidas de saída (px) para uma proporção: o lado maior fica em 1800 px. */
export function capaSize(aspect: number): { width: number; height: number } {
  return aspect >= 1 ? { width: 1800, height: Math.round(1800 / aspect) } : { width: Math.round(1800 * aspect), height: 1800 }
}
