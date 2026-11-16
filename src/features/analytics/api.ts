import { supabase } from "@/lib/supabase"
import { utcWindow } from "@/features/finance/summary"
import type { AnalyticsBooking, AnalyticsPayment, AnalyticsRefund, Range } from "./domain"
import type { Visit } from "./returns"

const PAGE = 1000
const MAX_PAGES = 20

type PageResult = PromiseLike<{ data: unknown[] | null; error: unknown }>

/** Lê todas as páginas (o servidor entrega no máximo 1000 linhas por vez), para o período não ser cortado em silêncio. */
async function all<T>(page: (from: number, to: number) => PageResult): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE, (i + 1) * PAGE - 1)
    if (error) throw error
    out.push(...((data ?? []) as T[]))
    if ((data ?? []).length < PAGE) return out
  }
  throw new Error("analytics_period_too_large")
}

export type AnalyticsData = { bookings: AnalyticsBooking[]; payments: AnalyticsPayment[]; refunds: AnalyticsRefund[] }

/**
 * Registros reais do intervalo (janela UTC larga; o corte exato por data local é feito em `domain.ts`). Só leitura:
 * o RLS limita à barbearia de quem está logado. Sem nome nem telefone de cliente.
 */
export async function fetchAnalytics(shopId: string, range: Range): Promise<AnalyticsData> {
  const { from, to } = utcWindow(range)
  const paidBooking = "bookings(service_id, servico_nome)"
  const [bookings, payments, refunds] = await Promise.all([
    all<AnalyticsBooking>((a, b) => supabase
      .from("bookings")
      .select("id, professional_id, service_id, servico_nome, duracao_min, inicio, status, professionals(nome, avatar_path)")
      .eq("barbershop_id", shopId).gte("inicio", from).lt("inicio", to)
      .order("inicio").order("id").range(a, b)),
    all<AnalyticsPayment>((a, b) => supabase
      .from("payments")
      .select(`id, valor_centavos, confirmado_em, ${paidBooking}`)
      .eq("barbershop_id", shopId).gte("confirmado_em", from).lt("confirmado_em", to)
      .order("confirmado_em").order("id").range(a, b)),
    all<AnalyticsRefund>((a, b) => supabase
      .from("refunds")
      .select(`id, valor_centavos, criado_em, payments(${paidBooking})`)
      .eq("barbershop_id", shopId).gte("criado_em", from).lt("criado_em", to)
      .order("criado_em").order("id").range(a, b)),
  ])
  return { bookings, payments, refunds }
}

/**
 * Todos os atendimentos CONCLUÍDOS da barbearia (histórico inteiro, paginado): a frequência de retorno não pode ser
 * calculada com histórico cortado. Só as colunas que identificam o cliente e o serviço.
 */
export function fetchCompletedHistory(shopId: string): Promise<Visit[]> {
  return all<Visit>((a, b) => supabase
    .from("bookings")
    .select("customer_id, cliente_nome, cliente_whatsapp, service_id, servico_nome, inicio")
    .eq("barbershop_id", shopId).eq("status", "concluido")
    .order("inicio").order("id").range(a, b))
}
