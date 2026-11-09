export type Papel = "proprietario" | "gerente" | "barbeiro" | "cliente"

export type MyBarbershop = {
  id: string
  nome: string
  slug: string
  endereco: string | null
  status: "ativo" | "inativo"
  fuso?: string
  papel: Papel
}

export const PAPEL_LABEL: Record<Papel, string> = {
  proprietario: "Proprietário",
  gerente: "Gerente",
  barbeiro: "Barbeiro",
  cliente: "Cliente",
}

/**
 * Decide apenas o que a interface mostra. Quem protege os dados é o RLS no banco.
 */
export function isCustomerOnly(barbershops: MyBarbershop[]): boolean {
  return barbershops.length > 0 && barbershops.every((shop) => shop.papel === "cliente")
}

/** Usado só para exibição: `user_metadata` é editável e nunca define permissões. */
export function firstName(metadata: Record<string, unknown> | undefined): string | null {
  const name = metadata?.full_name ?? metadata?.name
  if (typeof name !== "string") return null
  return name.trim().split(/\s+/)[0] || null
}

export function formatToday(date: Date): string {
  const text = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date)
  return text.charAt(0).toUpperCase() + text.slice(1)
}
