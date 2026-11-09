import { planErrorMessage } from "@/features/plans/domain"
export type Service = {
  id: string
  nome: string
  descricao: string | null
  preco_centavos: number
  duracao_min: number
  ativo: boolean
  imagem_path?: string | null
  /** Galeria do serviço (até 5). Caminhos no bucket de mídia. */
  fotos?: string[]
  /** Fotos com id (para remover). */
  galeria?: { id: string; path: string }[]
}

export type ServiceInput = Omit<Service, "id">

export type Professional = {
  id: string
  nome: string
  ativo: boolean
  avatar_path?: string | null
  service_ids: string[]
}

export type ProfessionalInput = {
  nome: string
  ativo: boolean
  serviceIds: string[]
}

export type CatalogResult<T> = { status: "ok"; data: T } | { status: "unavailable" }

const MAX_PRICE_CENTS = 10_000_000

/** Converte "60", "60,5", "1.234,56" ou "R$ 60,00" em centavos inteiros, sem ponto flutuante. */
export function parsePriceToCents(text: string): number | null {
  const clean = text.replace(/R\$/g, "").replace(/\s/g, "")
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(clean) ?? /^(\d+)\.(\d{1,2})$/.exec(clean)
  if (!match) return null
  const cents = Number(match[1].replace(/\./g, "")) * 100 + Number((match[2] ?? "").padEnd(2, "0"))
  return cents > MAX_PRICE_CENTS ? null : cents
}

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100)
}

export function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

type ServiceForm = { nome: string; descricao: string; preco: string; duracao: string; ativo?: boolean }

export function validateService(form: ServiceForm): { errors: Record<string, string>; value?: ServiceInput } {
  const errors: Record<string, string> = {}
  const nome = form.nome.trim()
  const descricao = form.descricao.trim()
  const preco = parsePriceToCents(form.preco)
  const duracao = /^\d+$/.test(form.duracao.trim()) ? Number(form.duracao.trim()) : NaN

  if (!nome) errors.nome = "Informe o nome do serviço."
  else if (nome.length > 80) errors.nome = "Use até 80 caracteres."
  if (descricao.length > 300) errors.descricao = "Use até 300 caracteres."
  if (preco === null) errors.preco = "Informe um valor válido, como 60,00."
  if (!(duracao >= 5 && duracao <= 480)) errors.duracao = "Informe de 5 a 480 minutos."

  if (Object.keys(errors).length > 0 || preco === null) return { errors }
  return {
    errors,
    value: { nome, descricao: descricao || null, preco_centavos: preco, duracao_min: duracao, ativo: form.ativo ?? true },
  }
}

export function validateProfessional({ nome }: { nome: string }): Record<string, string> {
  const value = nome.trim()
  if (!value) return { nome: "Informe o nome do profissional." }
  if (value.length > 80) return { nome: "Use até 80 caracteres." }
  return {}
}

/** Mensagem para o usuário, sem repassar detalhes internos do servidor. */
export function catalogErrorMessage(error: unknown, duplicate: string): string {
  const { code, message } = (error ?? {}) as { code?: string; message?: string }
  const plan = planErrorMessage({ message })
  if (plan) return plan
  if (message === "invalid_phone") return "Telefone inválido. Use +55 00 00000-0000 ou 00 0000-0000."
  if (message === "invalid_email") return "E-mail inválido."
  if (message === "invalid_document") return "CPF ou CNPJ inválido."
  if (code === "23505") return duplicate
  if (code === "42501") return "Você não tem permissão para esta alteração."
  return "Não foi possível salvar. Tente novamente."
}

const PHOTO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

/** Caminho da foto do serviço no bucket de mídia: a regra do banco (set_service_image) espera este formato. */
export function servicePhotoPath(shopId: string, serviceId: string, mime: string, id: string): string {
  return `${shopId}/servico-${serviceId}-${id}.${PHOTO_EXT[mime] ?? "bin"}`
}

export const MAX_SERVICE_PHOTOS = 5

/** URLs das fotos do serviço: a galeria (fotos) ou, na falta dela, a foto única antiga. */
export function servicePhotos(service: { imagem_path?: string | null; fotos?: string[] }, toUrl: (path: string) => string = (p) => p): string[] {
  const paths = service.fotos && service.fotos.length > 0 ? service.fotos : service.imagem_path ? [service.imagem_path] : []
  return paths.map(toUrl)
}

export function professionalAvatarPath(shopId: string, professionalId: string, mime: string, id: string): string {
  return `${shopId}/profissional-${professionalId}-${id}.${PHOTO_EXT[mime] ?? "bin"}`
}
