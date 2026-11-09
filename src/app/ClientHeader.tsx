import { Link, useNavigate } from "react-router-dom"
import { CalendarCheck, LogOut, Menu, Scissors, UserRound } from "lucide-react"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { publicMediaUrl } from "@/features/site/api"
import { shopBookingsPath, shopPath, shopSectionPath, type ShopSection } from "@/lib/shopPaths"
import { Button } from "@/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover"
import { toast } from "@/ui/sonner"

const NAV = [
  { label: "Serviços", section: "servicos" },
  { label: "Profissionais", section: "profissionais" },
  { label: "Nossa barbearia", section: null }, // o topo da página: nome, descrição e informações da barbearia
  { label: "Contato", section: "contato" },
] as const satisfies readonly { label: string; section: ShopSection | null }[]

/**
 * Cabeçalho da área do cliente DA BARBEARIA: marca da barbearia, atalhos para as seções reais da página pública
 * (a mesma que o cliente usa para agendar), Minhas reservas e o menu da conta. Sem páginas inventadas: cada link existe.
 */
export function ClientHeader({ slug, shop, onLogin }: { slug: string; shop?: { nome: string; logo_path?: string | null } | null; onLogin?: () => void }) {
  const { session, loading, logout } = useAuth()
  const navigate = useNavigate()
  const logo = publicMediaUrl(shop?.logo_path)
  const href = (section: ShopSection | null) => (section ? shopSectionPath(slug, section) : shopPath(slug))
  const name = typeof session?.user.user_metadata?.full_name === "string" ? session.user.user_metadata.full_name : ""

  const signOut = async () => {
    navigate(shopPath(slug), { replace: true })
    try { await logout() } catch { toast.error("Não foi possível sair. Tente novamente.") }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-[min(100%-2rem,1440px)] items-center gap-4 lg:gap-8">
        <Link to={shopPath(slug)} aria-label={`${shop?.nome ?? "Barbearia"}, ir para o início`} className="flex min-h-11 min-w-0 items-center gap-3 rounded-md">
          {logo ? <img src={logo} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" /> : (
            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Scissors className="h-5 w-5" /></span>
          )}
          <span className="truncate font-display text-xl font-bold tracking-wide">{shop?.nome ?? "Barbearia"}</span>
        </Link>

        <nav aria-label="Seções da barbearia" className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => <Link key={n.label} to={href(n.section)} className="rounded-md px-3 py-2 text-[15px] transition-colors hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{n.label}</Link>)}
        </nav>

        <nav aria-label="Conta" className={loading ? "invisible ml-auto flex items-center gap-2" : "ml-auto flex items-center gap-2"}>
          {session ? (
            <>
              <Link to={shopBookingsPath(slug)} aria-current="page" className="relative hidden min-h-11 items-center gap-2 px-2 text-[15px] font-medium text-primary sm:flex">
                <CalendarCheck aria-hidden="true" className="h-4 w-4" />Minhas reservas
                <span aria-hidden="true" className="absolute inset-x-1 -bottom-[13px] h-0.5 rounded-full bg-primary" />
              </Link>
              <span aria-hidden="true" className="hidden h-6 w-px bg-border sm:block" />
            </>
          ) : onLogin && <Button variant="outline" className="h-11 md:h-10" onClick={onLogin}>Acesso</Button>}

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full border border-border lg:hidden" aria-label="Menu da barbearia"><Menu aria-hidden="true" className="h-5 w-5" /></Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 p-1.5">
              <ul className="flex flex-col">
                {NAV.map((n) => <li key={n.label}><Link to={href(n.section)} className="flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-surface-alt">{n.label}</Link></li>)}
                {session && <li className="sm:hidden"><Link to={shopBookingsPath(slug)} className="flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-primary hover:bg-surface-alt">Minhas reservas</Link></li>}
              </ul>
            </PopoverContent>
          </Popover>

          {session && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full border border-border" aria-label="Conta"><UserRound aria-hidden="true" className="h-5 w-5" /></Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3">
                <div className="flex flex-col gap-0.5 border-b border-border pb-3">
                  {name && <p className="truncate text-sm font-semibold">{name}</p>}
                  <p className="truncate text-[13px] text-muted-foreground">{session.user.email}</p>
                </div>
                <Button variant="ghost" className="mt-2 h-11 w-full justify-start gap-2" onClick={signOut}><LogOut aria-hidden="true" className="h-4 w-4" />Sair</Button>
              </PopoverContent>
            </Popover>
          )}
        </nav>
      </div>
    </header>
  )
}
