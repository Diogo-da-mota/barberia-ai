import { isEmail, validateDocumento, validatePhone } from "@/lib/br"

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const

export const cepDigits = (text: string) => text.replace(/\D/g, "").slice(0, 8)
export const formatCep = (text: string) => { const d = cepDigits(text); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d }

export type TipoPessoa = "fisica" | "juridica"

/** Tudo o que a aba "Dados da barbearia" edita. Telefone e WhatsApp ficam formatados (+55…); CEP e documento, com máscara. */
export type ShopForm = {
  nome: string; nomeExibicao: string; razaoSocial: string; descricao: string
  telefone: string; whatsapp: string; email: string
  cep: string; logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string
  tipoPessoa: TipoPessoa; documento: string; inscricaoEstadual: string
}

/** Texto único de endereço que o site e as mensagens usam. Mesma regra da função save_shop_profile: "Rua, 123 - Bairro, Cidade - UF". */
export function composeAddress(f: Pick<ShopForm, "logradouro" | "numero" | "bairro" | "cidade" | "uf">): string | null {
  const t = (v: string) => v.trim()
  const rua = [t(f.logradouro), t(f.numero)].filter(Boolean).join(", ")
  const primeira = [rua, t(f.bairro)].filter(Boolean).join(" - ")
  const segunda = [t(f.cidade), t(f.uf).toUpperCase()].filter(Boolean).join(" - ")
  const full = [primeira, segunda].filter(Boolean).join(", ")
  return full ? full.slice(0, 200) : null
}

export const DESCRICAO_MAX = 500

/** Validação de conveniência no navegador, por campo. A que vale é a do servidor (save_shop_profile e save_shop_fiscal). */
export function validateShopForm(f: ShopForm, opts: { details: boolean; fiscal: boolean }): Record<string, string> {
  const e: Record<string, string> = {}
  if (!f.nome.trim()) e.nome = "Informe o nome da barbearia."
  if (f.descricao.length > DESCRICAO_MAX) e.descricao = `A descrição aceita até ${DESCRICAO_MAX} caracteres.`
  if (f.telefone.trim() && !validatePhone(f.telefone)) e.telefone = "Telefone inválido. Use +55 00 00000-0000 ou +55 00 0000-0000."
  if (opts.details) {
    if (f.whatsapp.trim() && !validatePhone(f.whatsapp)) e.whatsapp = "WhatsApp inválido. Use +55 00 00000-0000."
    if (f.email.trim() && !isEmail(f.email)) e.email = "E-mail inválido."
    if (f.cep && cepDigits(f.cep).length !== 8) e.cep = "O CEP tem 8 números."
    if (f.uf && !(UFS as readonly string[]).includes(f.uf)) e.uf = "Escolha o estado."
  }
  if (opts.fiscal && f.documento.trim()) {
    const digits = f.documento.replace(/\D/g, "")
    const expected = f.tipoPessoa === "fisica" ? 11 : 14
    if (digits.length !== expected || !validateDocumento(f.documento)) e.documento = f.tipoPessoa === "fisica" ? "CPF inválido. Confira os números." : "CNPJ inválido. Confira os números."
  }
  return e
}

const MESSAGES: Record<string, string> = {
  invalid_shop: "Confira o nome, o telefone, o WhatsApp, o e-mail e o endereço.",
  invalid_fiscal: "Confira os dados fiscais.",
  invalid_document: "CPF ou CNPJ inválido. Confira os números.",
  invalid_document_file: "Arquivo recusado. Use PDF, JPG ou PNG de até 10 MB.",
  document_not_found: "O envio do arquivo não foi concluído. Tente novamente.",
  document_limit: "Limite de 10 outros documentos. Remova um antes de enviar.",
  forbidden: "Você não tem permissão para esta ação.",
}
export function settingsErrorMessage(error: unknown): string {
  const { message } = (error ?? {}) as { message?: string }
  const key = Object.keys(MESSAGES).find((k) => message === k)
  return key ? MESSAGES[key] : "Não foi possível concluir. Tente novamente."
}

export const DOCUMENT_TYPES = [
  { value: "cnpj", label: "Comprovante de CNPJ", hint: "se for pessoa jurídica" },
  { value: "contrato_social", label: "Contrato social", hint: "se aplicável" },
  { value: "alvara", label: "Alvará de funcionamento", hint: "" },
  { value: "inscricao_estadual", label: "Inscrição estadual", hint: "se aplicável" },
  { value: "licenca_sanitaria", label: "Licença sanitária", hint: "se aplicável" },
  { value: "outro", label: "Outro documento", hint: "" },
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]["value"]
export const documentTypeLabel = (tipo: string) => DOCUMENT_TYPES.find((t) => t.value === tipo)?.label ?? tipo

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
export const DOCUMENT_MIMES = ["application/pdf", "image/jpeg", "image/png"] as const

/** Validação de conveniência no navegador. A que vale é a do bucket e de register_shop_document. */
export function validateDocumentFile(file: { type: string; size: number }): string | null {
  if (!(DOCUMENT_MIMES as readonly string[]).includes(file.type)) return "Use um arquivo PDF, JPG ou PNG."
  if (file.size <= 0) return "O arquivo está vazio."
  if (file.size > MAX_DOCUMENT_BYTES) return "O arquivo deve ter no máximo 10 MB."
  return null
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`
}

export type CepAddress = { logradouro: string; bairro: string; cidade: string; uf: string }
/** Resposta do ViaCEP → campos do formulário. `{ erro: true }` (CEP inexistente) ou formato inesperado = null. */
export function parseViaCep(json: unknown): CepAddress | null {
  if (!json || typeof json !== "object") return null
  const j = json as Record<string, unknown>
  if (j.erro) return null
  const s = (v: unknown) => (typeof v === "string" ? v : "")
  const out = { logradouro: s(j.logradouro), bairro: s(j.bairro), cidade: s(j.localidade), uf: s(j.uf).toUpperCase() }
  return out.cidade || out.logradouro ? out : null
}
