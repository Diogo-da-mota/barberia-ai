/** Valor em centavos ↔ texto digitado. Regra de entrada da direita para a esquerda, como em maquininha. */

export const MAX_MONEY_CENTS = 99_999_999 // 999.999,99

/** Exibe sempre no formato 00,00 · 01,00 · 10,00 · 100,00 · 1.000,00 (mínimo de 2 dígitos na parte inteira). */
export function formatMoneyInput(cents: number): string {
  const inteiro = Math.floor(cents / 100)
  const centavos = cents % 100
  const texto = String(inteiro).padStart(2, "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return `${texto},${String(centavos).padStart(2, "0")}`
}

/** Todos os dígitos digitados viram centavos: "1", "0", "0" → 100 → "01,00". */
export function centsFromTyping(text: string): number {
  const digits = text.replace(/\D/g, "")
  if (!digits) return 0
  return Math.min(Number(digits), MAX_MONEY_CENTS)
}
