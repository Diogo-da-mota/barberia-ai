import { useState } from "react"
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import {
  BarChart3,
  Calendar,
  CalendarCheck,
  Contact,
  Wallet,
  ExternalLink,
  Home,
  ListChecks,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Palette,
  MoreHorizontal,
  Scissors,
  Settings,
  Sun,
  Users,
} from "lucide-react"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { useActiveBarbershop } from "@/features/catalog/hooks/useActiveBarbershop"
import { ShopLogo } from "@/features/site/components/ShopLogo"
import { useShopLogo } from "@/features/site/hooks/useShopLogo"
import { usePanelPhoto } from "@/features/site/hooks/usePanelPhoto"
import { HeroPhoto, SidebarPhoto } from "./PanelPhotos"
import { isDark, useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/ui/sheet"
import { toast } from "@/ui/sonner"
import { shopPath } from "@/lib/shopPaths"
import { clientAccessPath } from "@/features/auth/lastShop"
import { LaraLauncher } from "@/features/settings/components/LaraLauncher"

const DESTINATIONS = [
  { href: "/dashboard", label: "Início", shortLabel: "Início", icon: Home },
  { href: "/agendamentos", label: "Agendamentos", shortLabel: "Agenda", icon: Calendar },
  { href: "/servicos", label: "Serviços", shortLabel: "Serviços", icon: ListChecks },
  { href: "/equipe", label: "Equipe", shortLabel: "Equipe", icon: Users },
  { href: "/mais", label: "Mais", shortLabel: "Mais", icon: MoreHorizontal },
]

type Destination = { href: string; label: string; icon: typeof Home }

const ALL = {
  inicio: { href: "/dashboard", label: "Início", icon: Home },
  agenda: { href: "/agendamentos", label: "Agendamentos", icon: Calendar },
  clientes: { href: "/clientes", label: "Clientes", icon: Contact },
  servicos: { href: "/servicos", label: "Serviços", icon: ListChecks },
  equipe: { href: "/equipe", label: "Equipe", icon: Users },
  mensagens: { href: "/mensagens", label: "Mensagens", icon: MessageSquare },
  site: { href: "/site", label: "Meu site", icon: Palette },
  configuracoes: { href: "/configuracoes", label: "Configurações", icon: Settings },
  financeiro: { href: "/financeiro", label: "Financeiro", icon: Wallet },
  analises: { href: "/analises", label: "Análises", icon: BarChart3 },
  reservas: { href: "/minhas-reservas", label: "Minhas reservas", icon: CalendarCheck },
  mais: { href: "/mais", label: "Mais", icon: MoreHorizontal },
} satisfies Record<string, Destination>

type ShellProps = {
  children?: React.ReactNode
  /** Fotografia de fundo atrás do cabeçalho e da saudação (só no tema escuro): a tela inicial. A barbearia troca em Meu site › Fotos. */
  hero?: boolean
}

function Brand({ collapsible = false }: { collapsible?: boolean }) {
  return (
    <Link
      to="/dashboard"
      aria-label="Barberia AI, ir para o início"
      className="flex min-h-11 items-center gap-2 rounded-md md:min-h-10"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <Scissors className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className={cn("font-display text-xl font-bold tracking-wide", collapsible && "md:hidden lg:inline")}>
        Barberia AI
      </span>
    </Link>
  )
}

export function Shell({ children, hero }: ShellProps) {
  const { theme, toggleTheme } = useTheme()
  const { logout, session, area } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const gate = useActiveBarbershop()
  const [menuOpen, setMenuOpen] = useState(false)

  // Menu da sidebar por papel. A barra inferior do celular mantém os 5 destinos do Design System.
  const shop = gate.state === "ready" ? gate.active : null
  // Na área do cliente (/minhas-reservas) o Shell só mostra as reservas: o painel tem sessão própria (porta do sistema).
  const sidebar: Destination[] = area === "cliente"
    ? [ALL.reservas]
    : shop
    ? [
        ALL.inicio, ALL.agenda, ALL.clientes, ALL.servicos, ALL.equipe,
        ALL.financeiro,
        ...(gate.canManage ? [ALL.analises, ALL.mensagens, ALL.site, ALL.configuracoes] : []),
        ALL.mais,
      ]
    : [ALL.inicio, ALL.reservas, ALL.mais]

  const handleLogout = async () => {
    // Sai da área protegida antes de encerrar a sessão, para o AuthGuard não abrir o popup de login.
    navigate(area === "cliente" ? clientAccessPath() : "/", { replace: true })
    try {
      await logout()
    } catch {
      toast.error("Não foi possível sair. Tente novamente.")
    }
  }

  const ThemeIcon = isDark(theme) ? Sun : Moon
  const dark = isDark(theme)
  const logo = useShopLogo(shop?.id)
  const sidebarPhoto = usePanelPhoto(dark ? shop?.id : null, "menu") // as fotos do painel só aparecem no tema escuro
  const withHero = Boolean(hero) && dark
  const heroPhoto = usePanelPhoto(withHero ? shop?.id : null, "inicio")
  const meta = session?.user.user_metadata as Record<string, unknown> | undefined
  const userName = typeof meta?.full_name === "string" ? meta.full_name : typeof meta?.name === "string" ? meta.name : ""
  const avatar = typeof meta?.avatar_url === "string" ? meta.avatar_url : typeof meta?.picture === "string" ? meta.picture : null
  const firstName = userName.trim().split(/\s+/)[0] || "Conta"

  return (
    <div className="relative flex h-dvh overflow-hidden bg-background text-foreground">
      {/* Sidebar: só ícones de 768px a 1023px; completa a partir de 1024px (Design System, seção 12). A foto fica abaixo de "Mais". */}
      <aside className="relative hidden w-16 shrink-0 flex-col overflow-hidden border-r border-border bg-card md:flex lg:w-64">
        {dark && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-[60%] lg:block">
            <SidebarPhoto src={sidebarPhoto} />
          </div>
        )}
        <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 lg:p-5">
          <div className="flex justify-center lg:justify-start">
            <Brand collapsible />
          </div>

          <p className="hidden px-3 pt-2 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase lg:block">Menu</p>
          <nav aria-label="Navegação principal" className="flex flex-col gap-1.5">
            {sidebar.map(({ href, label, icon: Icon }) => (
              <NavLink
                key={href}
                to={href}
                end={href === "/dashboard"}
                title={label}
                className={({ isActive }) =>
                  cn(
                    "flex h-11 items-center justify-center gap-3 rounded-xl border text-[15px] font-medium transition-colors lg:justify-start lg:px-3.5",
                    isActive
                      ? "border-primary/70 bg-primary/15 text-foreground shadow-sm"
                      : "border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={cn("h-5 w-5 shrink-0", isActive && "text-primary")} aria-hidden="true" />
                    <span className="md:sr-only lg:not-sr-only">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto flex flex-col gap-1 pt-4">
            <Button
              variant="ghost"
              onClick={toggleTheme}
              title="Alternar tema"
              className="justify-center gap-3 px-0 text-foreground/80 hover:bg-foreground/10 lg:justify-start lg:px-3"
            >
              <ThemeIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="sr-only">Alternar tema</span>
              <span aria-hidden="true" className="hidden lg:inline">
                {isDark(theme) ? "Tema claro" : "Tema escuro"}
              </span>
            </Button>
            <Button
              variant="ghost"
              onClick={handleLogout}
              title="Sair"
              className="justify-center gap-3 px-0 text-foreground/80 hover:bg-foreground/10 lg:justify-start lg:px-3"
            >
              <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="md:sr-only lg:not-sr-only">Sair</span>
            </Button>
          </div>
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        {withHero && <HeroPhoto src={heroPhoto} />}
        <header
          aria-label="Cabeçalho do painel"
          className={cn(
            "relative z-20 flex shrink-0 items-center justify-between gap-2 py-1 pr-2 pl-4 md:px-6 md:py-3",
            withHero ? "bg-transparent" : "border-b border-border bg-card"
          )}
        >
          <div className="md:hidden">
            <Brand />
          </div>
          {shop && (
            <p className="hidden h-11 min-w-0 items-center gap-2.5 rounded-xl border border-border bg-card/80 px-3.5 font-display text-base font-semibold tracking-wide backdrop-blur-md md:flex">
              <ShopLogo url={logo} className="h-7 w-7" />
              <span className="truncate">{shop.nome}</span>
            </p>
          )}
          <div className="flex items-center gap-1">
            {shop?.status === "ativo" && (
              <Button asChild variant="outline" className="h-11 gap-2 rounded-xl bg-card/80 px-3.5 backdrop-blur-md">
                <a href={shopPath(shop.slug)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  <span className="max-sm:sr-only">Ver site</span>
                </a>
              </Button>
            )}
            <Link
              to="/mais"
              aria-label={`Conta de ${firstName}`}
              className="hidden h-11 items-center gap-2.5 rounded-xl border border-border bg-card/80 py-1 pr-3.5 pl-1.5 backdrop-blur-md transition-colors hover:bg-card md:flex"
            >
              <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : firstName.charAt(0).toUpperCase()}
              </span>
              <span className="max-w-28 truncate text-sm font-medium">{firstName}</span>
            </Link>
            <div className="flex items-center md:hidden">
              <Button variant="ghost" size="icon" onClick={() => setMenuOpen(true)} aria-label="Menu" className="h-11 w-11 text-muted-foreground">
                <Menu className="h-5 w-5" aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Alternar tema" className="h-11 w-11 text-muted-foreground">
                <ThemeIcon className="h-5 w-5" aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="Sair" className="h-11 w-11 text-muted-foreground">
                <LogOut className="h-5 w-5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </header>

        <main className="relative z-10 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-6 md:pb-6">
          {children ?? <Outlet />}
        </main>
      </div>

      {/* Menu completo no celular: a mesma lista da sidebar (uma única fonte), sem destinos repetidos */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent className="flex flex-col gap-4 overflow-y-auto p-4 md:hidden" aria-describedby={undefined}>
          <SheetTitle className="font-display text-lg font-bold">Menu</SheetTitle>
          <nav aria-label="Menu completo" className="flex flex-col gap-1">
            {sidebar.map(({ href, label, icon: Icon }) => (
              <NavLink
                key={href}
                to={href}
                end={href === "/dashboard"}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-12 items-center gap-3 rounded-md border px-3 text-base font-medium",
                    isActive ? "border-primary bg-primary/10 text-foreground" : "border-transparent text-muted-foreground"
                  )
                }
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
        </SheetContent>
      </Sheet>

      {/* Barra inferior: até 767px (Design System, seção 12); só no painel */}
      {area === "painel" && <nav
        aria-label="Navegação principal"
        className="fixed right-0 bottom-0 left-0 z-50 grid grid-cols-5 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {DESTINATIONS.map(({ href, label, shortLabel, icon: Icon }) => (
          <NavLink
            key={href}
            to={href}
            end={href === "/dashboard"}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                "relative flex min-h-14 flex-col items-center justify-center gap-1 text-xs transition-colors",
                isActive ? "font-semibold text-foreground" : "text-muted-foreground"
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span aria-hidden="true" className="absolute inset-x-3 top-0 h-0.5 bg-primary" />}
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span>{shortLabel}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>}

      {/* Lara: botão flutuante da gestão em todo o painel (em Configurações › Assistente o chat já está na tela) */}
      {area === "painel" && shop && gate.canManage && pathname !== "/configuracoes" && <LaraLauncher shopId={shop.id} />}
    </div>
  )
}
