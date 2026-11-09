import { supabase } from "@/lib/supabase"

export type PlanUsage = {
  plano: string
  status: string
  max_profissionais: number | null
  profissionais_ativos: number
  trial_ate: string | null
  periodo_fim: string | null
  permite_novos: boolean
}

export async function fetchPlanUsage(shopId: string): Promise<PlanUsage | null> {
  const { data, error } = await supabase.rpc("get_plan_usage", { p_barbershop_id: shopId })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as PlanUsage | undefined
  return row ?? null
}
