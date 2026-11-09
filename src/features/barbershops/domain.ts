import { isReservedSlug } from "@/lib/shopPaths"

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Sugestão de endereço público a partir do nome: sem acentos, minúsculas e hifens. */
export function slugify(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "")
}

export function validateBarbershop({ nome, slug }: { nome: string; slug: string }): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!nome.trim()) errors.nome = "Informe o nome da barbearia."
  else if (nome.trim().length > 120) errors.nome = "Use até 120 caracteres."
  if (slug.length < 3 || slug.length > 60 || !SLUG_PATTERN.test(slug)) {
    errors.slug = "Use de 3 a 60 letras minúsculas, números e hífens."
  } else if (isReservedSlug(slug)) {
    errors.slug = "Este endereço é reservado pelo sistema. Escolha outro." // o endereço fica na raiz do site: nomes de rotas do sistema não podem ser usados
  }
  return errors
}
