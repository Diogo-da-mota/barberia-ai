/** Formatos e validações do Brasil: telefone, CPF/CNPJ e e-mail. As mesmas regras valem no banco (save_professional_contact). */

/** Padrão ÚNICO de telefone do site inteiro (campo, exibição, validação). */
export const PHONE_PLACEHOLDER = "+55 00 00000-0000"

/**
 * Dígitos nacionais (DDD + número), sem o código do país. O "+55" que a máscara mostra no campo é PREFIXO FIXO, não dígito:
 * é removido antes de contar. Sem o "+" (ex.: número colado), 12 ou 13 dígitos começando em 55 também perdem o 55;
 * com 11 dígitos o 55 é o DDD do RS e fica.
 */
export function phoneDigits(text: string): string {
  const t = text.trim()
  const comPrefixo = t.startsWith("+55")
  let d = (comPrefixo ? t.slice(3) : t).replace(/\D/g, "")
  if (!comPrefixo && !t.startsWith("+") && (d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2)
  // zero antes do DDD (064 99329-6649): prefixo de discagem, não faz parte do número
  if (d.length >= 12 && d.startsWith("0")) d = d.slice(1)
  return d.slice(0, 11)
}

/** Máscara progressiva: +55 11 3234-5678 (fixo) ou +55 11 91234-5678 (celular). O +55 é fixo; digite só DDD e número. */
export function formatPhone(text: string): string {
  const d = phoneDigits(text)
  if (!d) return ""
  const ddd = d.slice(0, 2)
  const rest = d.slice(2)
  if (!rest) return `+55 ${ddd}`
  const corte = rest.length > 8 ? 5 : 4 // celular (9 dígitos) corta 5-4; fixo corta 4-4
  const corpo = rest.length > corte ? `${rest.slice(0, corte)}-${rest.slice(corte)}` : rest
  return `+55 ${ddd} ${corpo}`
}

export function validatePhone(text: string): boolean {
  if (!text.trim()) return true
  return /^[1-9][1-9](9\d{8}|[2-5]\d{7})$/.test(phoneDigits(text))
}

const onlyDigits = (text: string) => text.replace(/\D/g, "")

export function formatDocumento(text: string): string {
  const d = onlyDigits(text).slice(0, 14)
  if (d.length <= 11) {
    return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4")
  }
  return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4").replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, "$1.$2.$3/$4-$5")
}

function validCpf(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false
  const dv = (len: number) => {
    let soma = 0
    for (let i = 0; i < len; i++) soma += Number(d[i]) * (len + 1 - i)
    return ((soma * 10) % 11) % 10
  }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

function validCnpj(d: string): boolean {
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false
  const calc = (pesos: number[]) => {
    const r = pesos.reduce((soma, peso, i) => soma + Number(d[i]) * peso, 0) % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[12]) && calc([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[13])
}

/** CPF (11 dígitos) ou CNPJ (14) com dígito verificador. Vazio é válido (campo opcional). */
export function validateDocumento(text: string): boolean {
  const d = onlyDigits(text)
  if (!d) return true
  return validCpf(d) || validCnpj(d)
}

export function isEmail(text: string): boolean {
  const v = text.trim()
  if (!v) return true
  return v.length <= 160 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)
}
