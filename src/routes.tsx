import { createBrowserRouter, Navigate, Outlet, useLocation, useParams, type RouteObject } from "react-router-dom"
import { SHOP_SECTIONS, shopBookingsPath, shopPath } from "@/lib/shopPaths"
import { Finance } from "@/features/finance/pages/Finance"
import { Messages } from "@/features/messaging/pages/Messages"
import { SiteSettings } from "@/features/site/pages/SiteSettings"
import { Home } from "@/features/home/pages/Home"
import { CreateBarbershop } from "@/features/barbershops/pages/CreateBarbershop"
import { Services } from "@/features/catalog/pages/Services"
import { Team } from "@/features/catalog/pages/Team"
import { AuthCallback } from "@/features/auth/pages/AuthCallback"
import { AuthGuard } from "@/features/auth/components/AuthGuard"
import { Landing } from "@/features/landing/pages/Landing"
import { Agenda } from "@/features/booking/pages/Agenda"
import { AcceptInvite } from "@/features/booking/pages/AcceptInvite"
import { Customers } from "@/features/booking/pages/Customers"
import { More } from "@/features/booking/pages/More"
import { MyBookings } from "@/features/booking/pages/MyBookings"
import { PublicShop } from "@/features/booking/pages/PublicShop"
import { ClientAccess, ClientBookings } from "@/features/booking/pages/ClientBookings"
import { clientAccessPath } from "@/features/auth/lastShop"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { fetchMyBarbershops } from "@/features/home/api"
import { isCustomerOnly } from "@/features/home/domain"
import { useQuery } from "@tanstack/react-query"

/** /e/:slug[/minhas-reservas] → /:slug[/minhas-reservas], preservando parâmetros de consulta e âncora. Nunca aponta para si mesma. */
export function LegacyShopRedirect({ bookings = false }: { bookings?: boolean }) {
  const { slug = "" } = useParams()
  const { search, hash, state } = useLocation()
  return <Navigate to={`${bookings ? shopBookingsPath(slug) : shopPath(slug)}${search}${hash}`} replace state={state} />
}

function LoginRedirect() {
  const { state } = useLocation()
  return <Navigate to="/?auth=entrar" replace state={state} />
}

/** Rotas de gestão: quem só tem vínculo de cliente volta para a área do cliente. A segurança real continua no banco (RLS). */
function StaffRoute() {
  const { session } = useAuth()
  const userId = session?.user.id
  const shops = useQuery({ queryKey: ["my-barbershops", userId], queryFn: () => fetchMyBarbershops(userId!), enabled: Boolean(userId) })
  if (shops.data?.status === "ok" && isCustomerOnly(shops.data.barbershops)) return <Navigate to="/minhas-reservas" replace />
  return <Outlet />
}

export const routes: RouteObject[] = [
  // Rotas públicas (não exigem sessão)
  { path: "/", element: <Landing /> },
  { path: "/login", element: <LoginRedirect /> },
  { path: "/auth/callback", element: <AuthCallback /> },
  { path: "/acesso", element: <ClientAccess /> },
  { path: "/convite", element: <AcceptInvite /> },
  // Links antigos (/e/:slug…) seguem funcionando: o vercel.json redireciona (308) e, onde não houver hospedagem, o roteador faz o mesmo.
  { path: "/e/:slug", element: <LegacyShopRedirect /> },
  { path: "/e/:slug/minhas-reservas", element: <LegacyShopRedirect bookings /> },
  // Endereços das barbearias na raiz. As rotas fixas acima e /dashboard têm prioridade sobre /:slug (o roteador ordena por especificidade),
  // e as palavras do sistema são reservadas (src/lib/shopPaths.ts) para nenhuma barbearia ocupar esses nomes.
  { path: "/:slug", element: <PublicShop /> },
  { path: "/:slug/minhas-reservas", element: <ClientBookings /> },
  ...SHOP_SECTIONS.map((section) => ({ path: `/:slug/${section}`, element: <PublicShop /> })),

  // Área do cliente (exige sessão confirmada pelo servidor)
  { path: "/minhas-reservas", element: <AuthGuard loginPath={clientAccessPath}><MyBookings /></AuthGuard> },

  // Rotas privadas (exigem sessão confirmada pelo servidor)
  {
    path: "/dashboard",
    element: (
      <AuthGuard>
        <Outlet />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <Home /> },
      {
        element: <StaffRoute />,
        children: [
          { path: "agendamentos", element: <Agenda /> },
          { path: "horarios", element: <Navigate to="/dashboard/equipe" replace /> }, // os horários agora ficam na edição do profissional (Equipe)
          { path: "clientes", element: <Customers /> },
          { path: "financeiro", element: <Finance /> },
          { path: "mensagens", element: <Messages /> },
          { path: "site", element: <SiteSettings /> },
          { path: "servicos", element: <Services /> },
          { path: "equipe", element: <Team /> },
        ],
      },
      { path: "barbearias/nova", element: <CreateBarbershop /> },
      { path: "mais", element: <More /> },
    ],
  },

  { path: "*", element: <Navigate to="/" replace /> },
]

export const router = createBrowserRouter(routes)
