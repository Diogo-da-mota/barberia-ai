/**
 * Vendas reais dos serviços, só de atendimentos CONCLUÍDOS. Nada é inventado: sem dados, o resultado é vazio/null.
 * Período único e consistente para "Mais vendidos", o selo e o ticket médio.
 */
export const SALES_DAYS = 90
/** Menos atendimentos que isso não formam um ticket médio confiável. */
export const MIN_TICKET_SAMPLE = 3

export type SaleRow = { id: string; service_id: string | null; preco_centavos: number }
type PaymentLike = { id: string; booking_id: string; valor_centavos: number; confirmado_em?: string | null }
type RefundLike = { payment_id: string; valor_centavos: number }

/** Quantos atendimentos concluídos cada serviço teve no período. */
export function salesByService(sales: SaleRow[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const sale of sales) if (sale.service_id) counts.set(sale.service_id, (counts.get(sale.service_id) ?? 0) + 1)
  return counts
}

/** Serviço(s) com mais vendas no período (empate leva o selo junto). Sem nenhuma venda: ninguém. */
export function topSellers(counts: Map<string, number>): Set<string> {
  const max = Math.max(0, ...counts.values())
  return new Set(max > 0 ? [...counts].filter(([, n]) => n === max).map(([id]) => id) : [])
}

/**
 * Ticket médio REALIZADO: valor efetivamente recebido (pagamentos confirmados menos estornos) por atendimento concluído
 * que recebeu algo. Não é o preço médio do cadastro. Menos de MIN_TICKET_SAMPLE atendimentos: null ("Sem dados suficientes").
 */
export function averageTicket(sales: SaleRow[], payments: PaymentLike[], refunds: RefundLike[]): { cents: number; count: number } | null {
  const refunded = new Map<string, number>()
  for (const r of refunds) refunded.set(r.payment_id, (refunded.get(r.payment_id) ?? 0) + r.valor_centavos)
  const received = new Map<string, number>()
  for (const p of payments) {
    if (p.confirmado_em === null) continue // "a confirmar" ainda não entrou no caixa
    received.set(p.booking_id, (received.get(p.booking_id) ?? 0) + p.valor_centavos - (refunded.get(p.id) ?? 0))
  }
  let total = 0
  let count = 0
  for (const sale of sales) {
    const net = received.get(sale.id) ?? 0
    if (net > 0) { total += net; count += 1 }
  }
  return count >= MIN_TICKET_SAMPLE ? { cents: Math.round(total / count), count } : null
}
