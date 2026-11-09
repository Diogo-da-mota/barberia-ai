import { useQuery } from "@tanstack/react-query"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { fetchMyBookings, fetchShopBookings, fetchShopHours } from "@/features/booking/api"
import { fetchReport } from "@/features/finance/api"
import { monthRange } from "@/features/finance/domain"
import { computeOccupancy, computeStats, isActive } from "@/features/booking/domain"
import { fetchMyBarbershops } from "../api"
import { useShopLogo } from "@/features/site/hooks/useShopLogo"
import { HomeView } from "../components/HomeView"
import { firstName, isCustomerOnly } from "../domain"

export function Home() {
  const { session } = useAuth()
  const userId = session?.user.id

  const barbershops = useQuery({
    queryKey: ["my-barbershops", userId],
    queryFn: () => fetchMyBarbershops(userId!),
    enabled: Boolean(userId),
  })

  const result = barbershops.data
  const shops = result?.status === "ok" ? result.barbershops : []
  const manager = shops.find((shop) => shop.papel !== "cliente")
  const tz = manager?.fuso ?? "America/Sao_Paulo"
  const hasShops = shops.length > 0

  // Dados reais: a gestão vê as reservas da barbearia; os demais, as próprias reservas
  const bookings = useQuery({
    queryKey: ["home-bookings", userId, manager?.id ?? "cliente"],
    queryFn: () => (manager ? fetchShopBookings(manager.id) : fetchMyBookings()),
    enabled: hasShops,
  })
  const isManager = manager?.papel === "proprietario" || manager?.papel === "gerente"
  const hours = useQuery({ queryKey: ["shop-hours", manager?.id], queryFn: () => fetchShopHours(manager!.id), enabled: isManager })
  const range = monthRange(new Date(), tz)
  // Recebido no mês (só confirmado): relatório financeiro real, só para a gestão
  const report = useQuery({ queryKey: ["finance-report", manager?.id, range.de, range.ate], queryFn: () => fetchReport(manager!.id, range.de, range.ate), enabled: isManager })
  const received: number | null | undefined = isManager ? (report.data ? report.data.recebido_centavos : null) : undefined
  const now = new Date()
  const upcoming = (bookings.data ?? [])
    .filter((b) => isActive(b.status) && new Date(b.fim) >= now)
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
    .slice(0, 6)
  const rows = !hasShops || bookings.isError ? [] : bookings.data ? upcoming : undefined
  const stats = manager && bookings.data ? computeStats(bookings.data, tz) : null
  // Ocupação só para a gestão: o barbeiro vê apenas as próprias reservas e não teria o total da equipe
  const occupancy = isManager && bookings.data && hours.data ? computeOccupancy(bookings.data, hours.data, tz) : null

  const customerOnly = result?.status === "ok" && isCustomerOnly(result.barbershops)
  const name = firstName(session?.user.user_metadata)

  const logoUrl = useShopLogo(manager?.id)
  const siteSlug = manager?.status === "ativo" ? manager.slug : null

  return (
    <HomeView
      name={name} result={result} isError={barbershops.isError} isRetrying={barbershops.isFetching} onRetry={() => void barbershops.refetch()}
      customerOnly={customerOnly} isManager={isManager} siteSlug={siteSlug} tz={tz} rows={rows} allBookings={bookings.data ?? []}
      stats={stats} occupancy={occupancy} received={received} logoUrl={logoUrl}
    />
  )
}
