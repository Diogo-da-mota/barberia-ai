import { Scissors } from "lucide-react"
import { Dialog, DialogContent } from "@/ui/dialog"
import type { AuthView } from "../domain"
import { LoginForm, RecoverForm, SignUpForm } from "./AuthForms"

type AuthDialogProps = {
  open: boolean
  view: AuthView | null
  next: string
  notice: string | null
  onViewChange: (view: AuthView) => void
  onClose: () => void
  /** Porta do cliente final (página da barbearia, /acesso). Sem isto é a porta do sistema: dono e equipe → painel. */
  client?: boolean
  /** Nome e logo da barbearia na porta do cliente. */
  shopName?: string
  shopLogo?: string | null
  /** Foto da porta do cliente, trocada em Meu site › Fotos (null/omitida = padrão). Ignorada na porta do sistema. */
  photo?: string | null
}

/** Foto de barbearia (Unsplash). Se não carregar, o fundo em degradê abaixo continua bonito. */
const HERO = "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1200&q=80"

/**
 * Acesso (entrar, criar conta, recuperar senha). Desktop: foto à esquerda e formulário à direita.
 * Celular: só o formulário, sem foto. Textos separados: sistema (painel da barbearia) × cliente (reservas, com o nome da barbearia).
 */
export function AuthDialog({ open, view, next, notice, onViewChange, onClose, client = false, shopName, shopLogo, photo }: AuthDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-2rem)] max-w-[480px] gap-0 overflow-hidden bg-card p-0 md:grid md:min-h-[640px] md:max-w-[960px] md:grid-cols-2 md:rounded-3xl">
        <aside aria-hidden="true" className="relative hidden md:block">
          <AuthPhoto client={client} shopName={shopName} shopLogo={shopLogo} src={client ? photo : null} />
        </aside>
        <div className="flex max-h-[92dvh] flex-col justify-center gap-5 overflow-y-auto p-6 md:p-10">
          {view === "entrar" && <LoginForm next={next} notice={notice} onViewChange={onViewChange} client={client} shopName={shopName} />}
          {view === "criar-conta" && <SignUpForm next={next} onViewChange={onViewChange} client={client} shopName={shopName} />}
          {view === "recuperar" && <RecoverForm next={next} onViewChange={onViewChange} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Foto do acesso (lado esquerdo do pop-up no computador), a MESMA no pop-up e na prévia de Meu site › Fotos. `src` null = foto padrão. */
export function AuthPhoto({ client, shopName, shopLogo, src }: { client: boolean; shopName?: string; shopLogo?: string | null; src: string | null | undefined }) {
  return (
    <div data-photo={src ?? HERO} className="animate-slide-left absolute inset-3 overflow-hidden rounded-2xl bg-gradient-to-br from-primary/40 via-surface-alt to-background bg-cover bg-center" style={{ backgroundImage: `linear-gradient(to top, rgb(0 0 0 / 0.75), rgb(0 0 0 / 0.1) 55%), url("${src ?? HERO}")` }}>
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-8 text-white">
        {client && shopLogo
          ? <img src={shopLogo} alt="" className="size-12 rounded-xl object-cover" />
          : <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Scissors className="size-5" /></span>}
        <p className="font-display text-3xl leading-tight font-bold tracking-wide">{client ? (shopName ?? "Seu horário, do seu jeito.") : "Sua barbearia, organizada."}</p>
        <p className="text-sm text-white/80">{client ? "Agende, reagende e acompanhe suas reservas em poucos toques." : "Agenda, equipe, clientes e financeiro em um só lugar."}</p>
      </div>
    </div>
  )
}
