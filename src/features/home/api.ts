import { supabase } from "@/lib/supabase"
import type { MyBarbershop, Papel } from "./domain"

/** Resposta do PostgREST quando a tabela ainda não existe no banco. */
const TABLE_NOT_FOUND = "PGRST205"

export type MyBarbershopsResult =
  | { status: "ok"; barbershops: MyBarbershop[] }
  | { status: "unavailable" }

type MembershipRow = {
  papel: Papel
  barbershops: Omit<MyBarbershop, "papel"> | null
}

export async function fetchMyBarbershops(userId: string): Promise<MyBarbershopsResult> {
  const { data, error } = await supabase
    .from("memberships")
    .select("papel, barbershops(id, nome, slug, endereco, status, fuso)")
    .eq("profile_id", userId)

  if (error) {
    if (error.code === TABLE_NOT_FOUND) return { status: "unavailable" }
    throw error
  }

  const rows = data as unknown as MembershipRow[]
  return {
    status: "ok",
    barbershops: rows.flatMap(({ papel, barbershops }) =>
      barbershops ? [{ ...barbershops, papel }] : []
    ),
  }
}
