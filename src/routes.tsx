import { createBrowserRouter, Navigate, Outlet, useLocation, useParams, type RouteObject } from "react-router-dom"
import { PANEL_ROOTS, SHOP_AUTH_VIEWS, SHOP_SECTIONS, shopBookingsPath, shopPath } from "@/lib/shopPaths"
import { Finance } from "@/features/finance/pages/Finance"
import { Analytics } from "@/features/analytics/pages/Analytics"
import { Messages } from "@/features/messaging/pages/Messages"
import { SiteSettings } from "@/features/site/pages/SiteSettings"
import { Settings } from "@/features/settings/pages/Settings"
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
import { isCustomerOnly, isStaff } from "@/features/home/domain"
import { panelAuthPath } from "@/features/auth/domain"
import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"
import { toast } from "@/ui/sonner"

/** /e/:slug[/minhas-reservas] → /:slug[/minhas-reservas], preservando parâmetros de consulta e âncora. Nunca aponta para si mesma. */
export function LegacyShopRedirect({ bookings = false }: { bookings?: boolean }) {
  const { slug = "" } = useParams()
  const { search, hash, state } = useLocation()
  return <Navigate to={`${bookings ? shopBookingsPath(slug) : shopPath(slug)}${search}${hash}`} replace state={state} />
}

/** /dashboard/<tela>… → /<tela>…, preservando consulta e âncora (o `?aba=` antigo é convertido pela própria tela). Tela desconhecida volta ao Início. */
export function LegacyPanelRedirect() {
  const rest = useParams()["*"] ?? ""
  const { search, hash, state } = useLocation()
  const known = (PANEL_ROOTS as readonly string[]).includes(rest.split("/")[0])
  return <Navigate to={known ? `/${rest}${search}${hash}` : "/dashboard"} replace state={state} />
}

function LoginRedirect() {
  const { state } = useLocation()
  return <Navigate to={panelAuthPath()} replace state={state} />
}

/**
 * Painel (/dashboard e as telas da raiz): conta que só é cliente não fica logada aqui. A sessão do PAINEL é encerrada (a do cliente, se houver,
 * continua) e a pessoa vai para a porta do cliente. Conta sem nenhum vínculo segue (dono novo cria a barbearia). A segurança
 * real continua no banco (RLS).
 */
function PanelGate() {
  const { session, logout } = useAuth()
  const userId = session?.user.id
  const shops = useQuery({ queryKey: ["my-barbershops", userId], queryFn: () => fetchMyBarbershops(userId!), enabled: Boolean(userId) })
  const refused = shops.data?.status === "ok" && isCustomerOnly(shops.data.barbershops)
  useEffect(() => {
    if (!refused) return
    toast.info("Esta conta é de cliente. Entre pela página da barbearia para ver suas reservas.", { id: "conta-de-cliente" })
    void logout().catch(() => undefined)
  }, [refused, logout])
  if (refused) return <Navigate to={clientAccessPath()} replace />
  return <Outlet />
}

/** Rotas de gestão: só para quem é da equipe (proprietário, gerente ou barbeiro); quem ainda não tem barbearia volta ao Início. */
function StaffRoute() {
  const { session } = useAuth()
  const userId = session?.user.id
  const shops = useQuery({ queryKey: ["my-barbershops", userId], queryFn: () => fetchMyBarbershops(userId!), enabled: Boolean(userId) })
  const list = shops.data?.status === "ok" ? shops.data.barbershops : null
  if (list && !isStaff(list)) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

export const routes: RouteObject[] = [
  // Rotas públicas (não exigem sessão)
  { path: "/", element: <Landing /> },
  // Porta do sistema (dono e equipe). /login e /?auth=… (links antigos) levam para cá.
  { path: "/login", element: <LoginRedirect /> },
  { path: "/painel", element: <Navigate to={panelAuthPath()} replace /> },
  { path: "/painel/:view", element: <Landing /> },
  { path: "/auth/callback", element: <AuthCallback /> },
  { path: "/acesso", element: <ClientAccess /> },
  { path: "/convite", element: <AcceptInvite /> },
  // Links antigos (/e/:slug…) seguem funcionando: o vercel.json redireciona (308) e, onde não houver hospedagem, o roteador faz o mesmo.
  { path: "/e/:slug", element: <LegacyShopRedirect /> },
  { path: "/e/:slug/minhas-reservas", element: <LegacyShopRedirect bookings /> },
  // Endereços das barbearias na raiz. As rotas fixas acima e as do painel têm prioridade sobre /:slug (o roteador ordena por especificidade),
  // e as palavras do sistema são reservadas (src/lib/shopPaths.ts) para nenhuma barbearia ocupar esses nomes.
  { path: "/:slug", element: <PublicShop /> },
  { path: "/:slug/minhas-reservas", element: <ClientBookings /> },
  // Porta do cliente da barbearia: /slug/entrar, /slug/criar-conta, /slug/recuperar (a página da barbearia com o acesso aberto)
  ...SHOP_AUTH_VIEWS.map((view) => ({ path: `/:slug/${view}`, element: <PublicShop /> })),
  ...SHOP_SECTIONS.map((section) => ({ path: `/:slug/${section}`, element: <PublicShop /> })),

  // Área do cliente (exige sessão confirmada pelo servidor)
  { path: "/minhas-reservas", element: <AuthGuard loginPath={clientAccessPath}><MyBookings /></AuthGuard> },

  // Rotas privadas (exigem sessão confirmada pelo servidor). /dashboard é só o Início; as telas ficam na raiz (PANEL_ROOTS)
  // e as abas no caminho (/financeiro/despesas), lidas por usePathTab. O segmento opcional mantém a mesma tela ao trocar de aba.
  {
    element: (
      <AuthGuard>
        <PanelGate />
      </AuthGuard>
    ),
    children: [
      { path: "/dashboard", element: <Home /> },
      {
        element: <StaffRoute />,
        children: [
          { path: "/agendamentos", element: <Agenda /> },
          { path: "/horarios", element: <Navigate to="/equipe" replace /> }, // os horários ficam na edição do profissional (Equipe)
          { path: "/clientes", element: <Customers /> },
          { path: "/financeiro/:aba?", element: <Finance /> },
          { path: "/analises", element: <Analytics /> },
          { path: "/mensagens/:aba?", element: <Messages /> },
          { path: "/site/:aba?", element: <SiteSettings /> },
          { path: "/configuracoes", element: <Settings /> },
          { path: "/servicos", element: <Services /> },
          { path: "/equipe", element: <Team /> },
        ],
      },
      { path: "/barbearias/nova", element: <CreateBarbershop /> },
      { path: "/mais/:aba?", element: <More /> },
    ],
  },
  // Endereços antigos do painel (/dashboard/agendamentos…) seguem funcionando.
  { path: "/dashboard/*", element: <LegacyPanelRedirect /> },

  { path: "*", element: <Navigate to="/" replace /> },
]

export const router = createBrowserRouter(routes)
