import { Link, useNavigate } from "react-router-dom"
import { Scissors } from "lucide-react"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { shopBookingsPath, shopPath } from "@/lib/shopPaths"
import { Button } from "@/ui/button"
import { toast } from "@/ui/sonner"

/**
 * Cabeçalho das páginas públicas e da área do cliente (a gestão usa o Shell).
 * Com `shopName`/`slug` é o cabeçalho DA BARBEARIA: a marca é dela e o botão "Acesso" é a porta do cliente final.
 * Não há link para o painel aqui: a equipe entra pela landing (/) → /dashboard. A proteção de verdade está em AuthGuard, StaffRoute e no RLS.
 */
export function PublicHeader({ onLogin, shopName, slug, logoUrl }: { onLogin?: () => void; shopName?: string; slug?: string; logoUrl?: string | null }) {
  const { session, loading, logout } = useAuth()
  const navigate = useNavigate()
  const home = slug ? shopPath(slug) : "/"
  const bookingsPath = slug ? shopBookingsPath(slug) : "/minhas-reservas"

  const signOut = async () => {
    navigate(home, { replace: true })
    try {
      await logout()
    } catch {
      toast.error("Não foi possível sair. Tente novamente.")
    }
  }

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-16 w-[min(100%-2rem,1120px)] items-center justify-between gap-3">
        <Link to={home} aria-label={`${shopName ?? "Barberia AI"}, ir para o início`} className="flex min-h-11 min-w-0 items-center gap-2 rounded-md">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" />
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Scissors className="h-4 w-4" aria-hidden="true" />
            </span>
          )}
          <span className="truncate font-display text-lg font-bold tracking-wide">{shopName ?? "Barberia AI"}</span>
        </Link>

        <nav aria-label="Conta" className={loading ? "invisible flex items-center gap-1" : "flex items-center gap-1"}>
          {session ? (
            <>
              <Button asChild variant="ghost" className="h-11 md:h-10"><Link to={bookingsPath}>Minhas reservas</Link></Button>
              <Button variant="outline" className="h-11 md:h-10" onClick={signOut}>Sair</Button>
            </>
          ) : (
            onLogin && <Button variant="outline" className="h-11 md:h-10" onClick={onLogin}>{slug ? "Acesso" : "Entrar"}</Button>
          )}
        </nav>
      </div>
    </header>
  )
}
