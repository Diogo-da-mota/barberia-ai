import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { areaOf } from "@/lib/shopPaths"
import { Button } from "@/ui/button"
import { Panel } from "@/ui/finance"
import { toast } from "@/ui/sonner"
import { NewPasswordForm } from "../components/AuthForms"
import { authDoor, consumeNext, panelAuthPath, parseAuthCallback, peekNext, safeNext, type CallbackError } from "../domain"
import { finishAuthCallback, signOut, type AccountSwitch, type PasswordRecovery } from "../services/auth"

type Outcome = "recovery" | "senha-alterada" | "signed-in" | "confirmar" | CallbackError

/**
 * Link expirado, inválido ou já usado: volta à porta com a opção de pedir outro. Sem o verificador PKCE (e-mail no modelo
 * antigo, com `code`, aberto em outro navegador): o cadastro já foi confirmado; a nova senha precisa de um link novo.
 */
function failure(error: unknown, tipo: string | null): CallbackError {
  const code = (error as { code?: string })?.code
  if (code === "otp_expired") return "link-expirado"
  if (code !== "pkce_code_verifier_not_found") return "falha"
  return tipo === "cadastro" ? "confirmado" : tipo === "recuperar" ? "link-invalido" : "falha"
}

/**
 * Retorno do Google, da confirmação de e-mail e da recuperação de senha. Atualiza SÓ a sessão da área que iniciou o fluxo
 * (`?area=` no link; em links antigos, a área do destino guardado) e volta pela porta dela; a outra área não é tocada.
 */
export function AuthCallback() {
  const navigate = useNavigate()
  // Lidos na primeira renderização, antes de qualquer navegação (os efeitos podem rodar duas vezes no StrictMode).
  const [callback] = useState(() => parseAuthCallback(window.location.hash, window.location.search))
  const [saved] = useState(peekNext)
  const [area] = useState(() => callback.area ?? areaOf(saved ?? "/dashboard"))
  const { session, loading } = useAuth(area)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  // Link de e-mail de outra conta (ou, sem sessão, de conta que este navegador não pediu): só entra se a pessoa escolher a conta do link.
  const [troca, setTroca] = useState<AccountSwitch | null>(null)
  // Nova senha pelo link do e-mail: sessão temporária da conta do link; a sessão aberta nesta área não muda.
  const [recuperacao, setRecuperacao] = useState<PasswordRecovery | null>(null)
  const [escolhendo, setEscolhendo] = useState(false)
  // O destino guardado é um só no navegador: se um fluxo da outra área começou depois, ele não vale para esta.
  const own = (path: unknown) => { const next = safeNext(path); return areaOf(next) === area ? next : null }
  // Mesmo navegador: o destino guardado; outro aparelho: a porta gravada no link do e-mail
  const origin = own(saved) ?? own(callback.volta)
  const destination = origin ?? own(session?.user.user_metadata?.signup_next) ?? (area === "cliente" ? "/minhas-reservas" : "/dashboard")
  const shopDoor = authDoor(origin ?? "/dashboard")
  const failDoor = area === "painel" ? panelAuthPath() : shopDoor.startsWith("/painel/") ? "/acesso" : shopDoor
  const pending = !callback.error && callback.hasAuthParams

  useEffect(() => {
    if (!pending) return
    let active = true
    finishAuthCallback(area, callback)
      .then(({ recovery, troca: outra, recuperacao: nova }) => {
        if (!active) return
        if (outra) {
          setTroca(outra)
          setOutcome("confirmar")
          return
        }
        if (nova) setRecuperacao(nova)
        setOutcome(recovery || callback.isRecovery ? "recovery" : "signed-in")
      })
      .catch((error: unknown) => { if (active) setOutcome(failure(error, callback.tipo)) })
    // O link vale uma vez: tira o token do endereço e do histórico (a área continua, para as consultas desta tela)
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?area=${area}`)
    return () => { active = false }
  }, [area, callback, pending])

  // Com `recuperacao` não depende de sessão na área; sem ela (link antigo com `code`), a senha é trocada na sessão da área.
  const showNewPassword = outcome === "recovery" && !loading && Boolean(recuperacao ?? session)

  useEffect(() => {
    // Falhou ou não havia nada a concluir: volta pela mesma porta de onde a pessoa saiu (cliente → barbearia; equipe → painel)
    const leave = (to: string) => { consumeNext(); navigate(to, { replace: true }) }
    const door = (erro: CallbackError | null) => leave(erro ? `${failDoor}?erro=${erro}` : failDoor)
    if (callback.error) return door(callback.error)
    if (!pending) return door(null)
    if (outcome === null || outcome === "confirmar" || outcome === "senha-alterada" || loading || showNewPassword) return
    if (outcome === "signed-in" && session) {
      leave(destination)
      return
    }
    door(outcome === "signed-in" || outcome === "recovery" ? "falha" : outcome)
  }, [callback, pending, outcome, loading, session, showNewPassword, destination, failDoor, navigate])

  if (outcome === "confirmar" && troca) {
    const usarLink = () => {
      setEscolhendo(true)
      troca.confirmar().then(() => setOutcome("signed-in"), () => setOutcome("falha"))
    }
    // Mantém a sessão atual (a do link é encerrada) e segue para onde iria; sem sessão, volta à porta sem entrar
    const manter = () => {
      setEscolhendo(true)
      troca.cancelar().catch(() => undefined).finally(() => {
        if (troca.atual) return setOutcome("signed-in")
        consumeNext()
        navigate(failDoor, { replace: true })
      })
    }
    if (!troca.atual) {
      return (
        <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
          <Panel className="flex w-full max-w-[480px] flex-col gap-4 p-5 sm:p-6">
            <div className="flex flex-col gap-1.5">
              <h1 className="font-display text-2xl font-bold tracking-wide">Entrar com esta conta?</h1>
              <p className="text-sm text-muted-foreground">
                Este link é da conta <strong className="text-foreground">{troca.link}</strong>. Só continue se ela for sua.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button disabled={escolhendo} onClick={usarLink}>Entrar como {troca.link}</Button>
              <Button variant="outline" disabled={escolhendo} onClick={manter}>Cancelar</Button>
            </div>
          </Panel>
        </main>
      )
    }
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
        <Panel className="flex w-full max-w-[480px] flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display text-2xl font-bold tracking-wide">Trocar de conta?</h1>
            <p className="text-sm text-muted-foreground">
              Você está conectado como <strong className="text-foreground">{troca.atual}</strong>. Este link é da conta{" "}
              <strong className="text-foreground">{troca.link}</strong>.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button disabled={escolhendo} onClick={manter}>Continuar como {troca.atual}</Button>
            <Button variant="outline" disabled={escolhendo} onClick={usarLink}>Entrar como {troca.link}</Button>
          </div>
        </Panel>
      </main>
    )
  }

  if (showNewPassword) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
        <Panel className="flex w-full max-w-[480px] flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display text-2xl font-bold tracking-wide">Definir nova senha</h1>
            <p className="text-sm text-muted-foreground">
              Escolha a senha que você vai usar para entrar
              {recuperacao?.email ? <> na conta <strong className="text-foreground">{recuperacao.email}</strong></> : null}.
            </p>
          </div>
          <NewPasswordForm area={area} save={recuperacao?.salvar} onDone={() => setOutcome("senha-alterada")} />
        </Panel>
      </main>
    )
  }

  if (outcome === "senha-alterada") {
    // Nada entra sozinho: quem já estava conectado continua na própria conta; a conta recuperada só abre por escolha.
    const go = (to: string) => { consumeNext(); navigate(to, { replace: true }) }
    const conectado = session?.user.email ?? null
    const outraConta = Boolean(session && recuperacao?.email && recuperacao.email.toLowerCase() !== conectado?.toLowerCase())
    const entrarNaRecuperada = () => {
      setEscolhendo(true)
      signOut("local", area).then(() => go(failDoor), () => { setEscolhendo(false); toast.error("Não foi possível sair da conta atual. Tente novamente.") })
    }
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
        <Panel className="flex w-full max-w-[480px] flex-col gap-4 p-5 sm:p-6">
          <div role="status" className="flex flex-col gap-1.5">
            <h1 className="font-display text-2xl font-bold tracking-wide">Senha alterada</h1>
            <p className="text-sm text-muted-foreground">Senha alterada com sucesso. Agora você pode entrar na sua conta.</p>
            {outraConta && (
              <p className="text-sm text-muted-foreground">
                Você continua conectado como <strong className="text-foreground">{conectado}</strong>. A senha alterada é da conta{" "}
                <strong className="text-foreground">{recuperacao?.email}</strong>.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {!session && <Button onClick={() => go(failDoor)}>Entrar na minha conta</Button>}
            {session && <Button disabled={escolhendo} onClick={() => go(destination)}>{outraConta ? `Continuar como ${conectado}` : "Continuar"}</Button>}
            {outraConta && <Button variant="outline" disabled={escolhendo} onClick={entrarNaRecuperada}>Sair e entrar como {recuperacao?.email}</Button>}
          </div>
        </Panel>
      </main>
    )
  }

  return (
    <main role="status" className="flex min-h-dvh items-center justify-center bg-background p-6">
      <span className="text-sm text-muted-foreground">Processando login…</span>
    </main>
  )
}
