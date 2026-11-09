import { useEffect, useState, type ReactNode } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { Menu, Scissors } from "lucide-react"
import { AuthDialog } from "@/features/auth/components/AuthDialog"
import {
  CALLBACK_NOTICES,
  safeNext,
  SESSION_REJECTED_NOTICE,
  toAuthView,
  type AuthRedirectState,
  type AuthView,
  type CallbackError,
} from "@/features/auth/domain"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/ui/sheet"
import {
  AppFrameDemo,
  ChooseServiceDemo,
  ChooseTimeDemo,
  ConfirmDemo,
  ConflictDemo,
  HeroCollage,
  PublicPageDemo,
  RolesDemo,
  WorkingHoursDemo,
} from "../components/demos"

const WRAP = "mx-auto w-[min(100%-3rem,1280px)] md:w-[min(100%-6rem,1280px)] xl:w-[min(100%-10rem,1280px)]"
const H2 = "font-display text-[30px] leading-tight font-bold tracking-wide lg:text-5xl"
const SECTION = "scroll-mt-16 pt-24 pb-16 lg:min-h-svh lg:pt-30 lg:pb-24"
const PRESS = "transition-all hover:-translate-y-px active:translate-y-0 active:scale-[.98]"

const NAV_LINKS = [
  { href: "#beneficios", label: "Recursos" },
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#plataforma", label: "Plataforma" },
  { href: "#perguntas", label: "Perguntas" },
]

const BENEFITS = [
  { title: "Publica sua página de agendamento", text: "Cada barbearia tem um endereço próprio, com serviços e profissionais.", demo: <PublicPageDemo /> },
  { title: "Organiza a agenda por barbeiro", text: "Cada profissional tem jornada, pausas, folgas e bloqueios próprios.", demo: <WorkingHoursDemo /> },
  { title: "Recusa horário já ocupado", text: "O banco de dados confere o horário na confirmação e impede reserva duplicada.", demo: <ConflictDemo /> },
  { title: "Separa os dados de cada barbearia", text: "Cada barbearia vê só as próprias informações, e cada pessoa tem um papel.", demo: <RolesDemo /> },
]

const STEPS = [
  { title: "Escolhe serviço e profissional", text: "O cliente abre sua página e pode pedir qualquer profissional disponível.", demo: <ChooseServiceDemo /> },
  { title: "Escolhe data e horário", text: "Os horários livres respeitam jornada, pausas, duração do serviço e reservas.", demo: <ChooseTimeDemo /> },
  { title: "Confirma pela própria conta", text: "O cliente entra, revisa os dados e confirma. O horário vai para a agenda certa.", demo: <ConfirmDemo /> },
]

const QUESTIONS = [
  { question: "Dois clientes podem reservar o mesmo horário?", answer: "Não com o mesmo profissional. O servidor confere o horário de novo na confirmação, e só uma reserva é aceita. Profissionais diferentes podem atender ao mesmo tempo." },
  { question: "O cliente precisa de conta para agendar?", answer: "Serviços e horários ficam abertos para consulta. Para confirmar, consultar o histórico, cancelar ou reagendar, o cliente entra com a própria conta." },
  { question: "Uma pessoa pode trabalhar em mais de uma barbearia?", answer: "Pode. O papel vale por barbearia, e os dados de uma não aparecem para a outra." },
  { question: "O que acontece com reservas antigas quando o preço muda?", answer: "Elas continuam iguais. Cada reserva guarda o nome, o preço e a duração do serviço no momento em que foi criada." },
]

type AccessProps = {
  onOpenAuth: (view: AuthView) => void
  hasSession: boolean
  loading: boolean
}

function Brand() {
  return (
    <a href="#top" className="flex min-h-11 items-center gap-2 rounded-md">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Scissors className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="font-display text-lg font-bold tracking-wide">Barberia AI</span>
    </a>
  )
}

function MainAction({ onOpenAuth, hasSession, size = "default", className }: Omit<AccessProps, "loading"> & { size?: "default" | "lg"; className?: string }) {
  const classes = cn(PRESS, "h-11 md:h-10", size === "lg" && "h-12 px-8 text-base md:h-12", className)
  if (hasSession) {
    return (
      <Button asChild className={classes}>
        <Link to="/dashboard">Abrir painel</Link>
      </Button>
    )
  }
  return (
    <Button className={classes} onClick={() => onOpenAuth("criar-conta")}>
      Criar conta
    </Button>
  )
}

function Header({ onOpenAuth, hasSession, loading }: AccessProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-border bg-card">
      <div className={cn(WRAP, "grid h-16 grid-cols-[1fr_auto] items-center gap-3 lg:grid-cols-[1fr_auto_1fr]")}>
        <nav aria-label="Navegação pública" className="hidden items-center gap-6 lg:flex">
          {NAV_LINKS.map(({ href, label }) => (
            <a key={href} href={href} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
              {label}
            </a>
          ))}
        </nav>

        <div className="lg:justify-self-center">
          <Brand />
        </div>

        <div className={cn("flex items-center justify-end gap-2", loading && "invisible")}>
          {!hasSession && (
            <Button variant="outline" className={cn(PRESS, "h-11 md:h-10")} onClick={() => onOpenAuth("entrar")}>
              Entrar
            </Button>
          )}
          <MainAction onOpenAuth={onOpenAuth} hasSession={hasSession} className="hidden sm:inline-flex" />

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Abrir menu" className="h-11 w-11 lg:hidden">
                <Menu className="h-5 w-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent className="flex flex-col gap-2 p-6 sm:w-full">
              <SheetTitle className="font-display text-xl font-bold">Menu</SheetTitle>
              <SheetDescription className="sr-only">Navegue pelas seções da página.</SheetDescription>
              <nav aria-label="Menu da página" className="mt-4 flex flex-col">
                {NAV_LINKS.map(({ href, label }) => (
                  <a key={href} href={href} onClick={() => setMenuOpen(false)} className="flex min-h-12 items-center border-b border-border text-base font-medium">
                    {label}
                  </a>
                ))}
              </nav>
              {!hasSession && (
                <Button
                  className="mt-4 h-12"
                  onClick={() => {
                    setMenuOpen(false)
                    onOpenAuth("criar-conta")
                  }}
                >
                  Criar conta
                </Button>
              )}
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}

function Card({ title, text, demo, number }: { title: string; text: string; demo: ReactNode; number?: number }) {
  return (
    <article className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
      {number !== undefined && (
        <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-primary font-display font-bold text-primary-foreground">
          {number}
        </span>
      )}
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-base text-muted-foreground">{text}</p>
      <div className="mt-auto pt-1">{demo}</div>
    </article>
  )
}

export function Landing() {
  const { session, loading } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const hasSession = Boolean(session)

  const view = toAuthView(searchParams.get("auth"))
  const redirect = location.state as AuthRedirectState
  const sessionRejected = Boolean(redirect?.sessionRejected)
  const next = safeNext(redirect?.from)
  const notice = sessionRejected
    ? SESSION_REJECTED_NOTICE
    : (CALLBACK_NOTICES[searchParams.get("erro") as CallbackError] ?? null)

  // Login concluído: a sessão chega por aqui em todos os métodos de login. Uma sessão
  // recusada pelo servidor não redireciona, o que evita ciclo com o AuthGuard.
  useEffect(() => {
    if (!loading && session && view && !sessionRejected) navigate(next, { replace: true })
  }, [loading, session, view, sessionRejected, next, navigate])

  const openAuth = (target: AuthView) => setSearchParams({ auth: target })
  const changeView = (target: AuthView) =>
    setSearchParams({ auth: target }, { replace: true, state: location.state })
  const closeAuth = () => setSearchParams({}, { replace: true })
  const access = { onOpenAuth: openAuth, hasSession }

  return (
    <div id="top" className="min-h-svh bg-background text-foreground">
      <Header {...access} loading={loading} />

      <main>
        <section className="flex min-h-svh flex-col pt-24 pb-6 lg:h-svh lg:min-h-[640px] lg:pt-[120px] lg:pb-16">
          <div className={cn(WRAP, "flex flex-1 flex-col gap-8 lg:grid lg:grid-cols-12 lg:gap-6")}>
            <div className="flex flex-col items-start gap-5 lg:col-span-5">
              <h1 className="font-display text-[40px] leading-[1.02] font-bold tracking-wide lg:text-[64px]">
                Agendamento online para barbearias
              </h1>
              <p className="max-w-[62ch] text-lg text-muted-foreground lg:text-xl">
                Sua barbearia ganha uma página pública de agendamento, e a agenda de cada barbeiro não aceita dois clientes no mesmo horário.
              </p>
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                <MainAction {...access} className="w-full sm:w-auto" />
                <Button asChild variant="outline" className={cn(PRESS, "h-11 w-full sm:w-auto md:h-10")}>
                  <a href="#como-funciona">Ver como funciona</a>
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                O cliente agenda em 3 etapas, pelo celular ou pelo computador.
              </p>
            </div>
            <div className="flex min-h-56 flex-1 flex-col lg:col-span-6 lg:col-start-7">
              <HeroCollage />
            </div>
          </div>
        </section>

        <section id="beneficios" className={SECTION}>
          <div className={WRAP}>
            <h2 className={H2}>Recursos para a rotina da barbearia</h2>
            <div className="mt-8 grid gap-4 md:grid-cols-2 lg:mt-12 xl:grid-cols-4">
              {BENEFITS.map((benefit) => (
                <Card key={benefit.title} {...benefit} />
              ))}
            </div>
          </div>
        </section>

        <section id="como-funciona" className={SECTION}>
          <div className={WRAP}>
            <h2 className={H2}>Como funciona o agendamento</h2>
            <p className="mt-3 max-w-[62ch] text-lg text-muted-foreground">
              São 3 etapas para o cliente. Depois, ele consulta, cancela ou reagenda pela própria conta.
            </p>
            <div className="mt-8 grid gap-4 lg:mt-12 lg:grid-cols-3">
              {STEPS.map((step, index) => (
                <Card key={step.title} {...step} number={index + 1} />
              ))}
            </div>
          </div>
        </section>

        <section id="plataforma" className={SECTION}>
          <div className={WRAP}>
            <div className="grid gap-3 lg:grid-cols-12 lg:gap-6">
              <h2 className={cn(H2, "lg:col-span-5")}>A agenda do dia por profissional</h2>
              <p className="max-w-[62ch] text-lg text-muted-foreground lg:col-span-6 lg:col-start-7">
                Atendimentos e bloqueios ocupam o mesmo espaço na agenda. Horários contíguos são aceitos, e os sobrepostos, não.
              </p>
            </div>
            <div className="mt-8 lg:mt-12">
              <AppFrameDemo />
            </div>
          </div>
        </section>

        <section id="perguntas" className={SECTION}>
          <div className={cn(WRAP, "grid gap-8 lg:grid-cols-12 lg:gap-6")}>
            <h2 className={cn(H2, "lg:col-span-5")}>Perguntas sobre a plataforma</h2>
            <div className="divide-y divide-border lg:col-span-6 lg:col-start-7">
              {QUESTIONS.map(({ question, answer }) => (
                <details key={question} open className="py-4 first:pt-0">
                  <summary className="flex min-h-11 cursor-pointer items-center text-lg font-semibold">
                    {question}
                  </summary>
                  <p className="mt-2 text-base text-muted-foreground">{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="flex flex-col">
        <div className={cn(WRAP, "flex flex-col gap-6 pt-16 pb-16 lg:pt-30 lg:pb-24")}>
          <h2 className={H2}>Sua conta no Barberia AI</h2>
          <p className="max-w-[62ch] text-lg text-muted-foreground">
            Use sua conta Google ou crie uma com email e senha.
          </p>
          <MainAction {...access} size="lg" className="w-full" />
        </div>

        <div className="bg-board text-board-foreground">
          <div className={cn(WRAP, "grid gap-8 py-12 sm:grid-cols-2")}>
            <div className="flex items-center gap-2 self-start">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-board-amber text-primary-foreground">
                <Scissors className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="font-display text-lg font-bold tracking-wide">Barberia AI</span>
            </div>
            <nav aria-label="Rodapé" className="flex flex-col gap-1 sm:justify-self-end">
              {NAV_LINKS.map(({ href, label }) => (
                <a key={href} href={href} className="flex min-h-11 items-center text-sm text-board-foreground hover:underline md:min-h-8">
                  {label}
                </a>
              ))}
            </nav>
            <p className="text-[13px] text-board-muted sm:col-span-2">© {new Date().getFullYear()} Barberia AI</p>
          </div>
        </div>
      </footer>

      <AuthDialog
        open={Boolean(view) && !loading && (!session || sessionRejected)}
        view={view}
        next={next}
        notice={notice}
        onViewChange={changeView}
        onClose={closeAuth}
      />
    </div>
  )
}
