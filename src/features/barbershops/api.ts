import { supabase } from "@/lib/supabase"

/** Cria a barbearia e o vínculo de proprietário em uma única operação do servidor. */
export async function createBarbershop(nome: string, slug: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_barbershop", { p_nome: nome, p_slug: slug })
  if (error) {
    throw error
  }
  return data as string
}
