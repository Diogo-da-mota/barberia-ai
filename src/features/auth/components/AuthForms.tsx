import { useId, useState, type FormEvent, type ReactNode } from "react"
import { Eye, EyeOff } from "lucide-react"
import { phoneDigits, validatePhone } from "@/lib/br"
import { Button } from "@/ui/button"
import { DialogDescription, DialogTitle } from "@/ui/dialog"
import { Field } from "@/ui/finance"
import { Input } from "@/ui/input"
import {
  authErrorMessage,
  validateLogin,
  validateNewPassword,
  validateRecover,
  validateSignUp,
  type AuthView,
} from "../domain"
import { requestPasswordReset, signInWithGoogle, signInWithPassword, signUp, updatePassword } from "../services/auth"
import type { AuthArea } from "@/lib/shopPaths"

type Values = Record<string, string>

const FIELD_CLASS = "h-12 rounded-2xl border-border bg-foreground/5 px-4 text-base backdrop-blur-sm transition-colors focus-visible:border-primary/70 focus-visible:bg-primary/10 md:h-12 md:text-sm"
const SUBMIT_CLASS = "h-12 w-full rounded-2xl text-base font-semibold md:h-12 md:text-sm"
const TEXT_ACTION = "inline-flex min-h-11 items-center rounded-md text-sm font-medium text-link underline-offset-4 hover:underline md:min-h-8"

export function GoogleIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.022 35.026 44 30.038 44 24c0-2.641-.21-5.236-.611-7.743z" />
    </svg>
  )
}

function useAuthForm(validate: (values: Values) => Record<string, string>, action: (values: Values) => Promise<void>) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const run = async (task: () => Promise<void>) => {
    setServerError(null)
    setPending(true)
    try {
      await task()
    } catch (error) {
      setServerError(authErrorMessage(error))
    } finally {
      setPending(false)
    }
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form)) as Values
    const found = validate(values)
    setErrors(found)
    setServerError(null)

    const [firstInvalid] = Object.keys(found)
    if (firstInvalid) {
      ;(form.elements.namedItem(firstInvalid) as HTMLElement | null)?.focus()
      return
    }
    await run(() => action(values))
  }

  return { errors, serverError, pending, onSubmit, run }
}

type AuthInputProps = {
  label: string
  name: string
  error?: string
  type?: "text" | "email" | "password" | "tel"
  autoComplete: string
}

function AuthInput({ label, name, error, type = "text", autoComplete }: AuthInputProps) {
  const id = useId()
  const errorId = `${id}-erro`
  const [visible, setVisible] = useState(false)
  const isPassword = type === "password"

  return (
    <Field label={label} htmlFor={id} error={error} errorId={errorId}>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={isPassword && visible ? "text" : type}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={isPassword ? `${FIELD_CLASS} pr-12` : FIELD_CLASS}
        />
        {isPassword && (
          <button
            type="button"
            aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
            onClick={() => setVisible((current) => !current)}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            {visible ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
          </button>
        )}
      </div>
    </Field>
  )
}

function FormAlert({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  )
}

function Header({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <div className="animate-element animate-delay-100 flex flex-col gap-1.5 pr-8 text-left">
      {eyebrow && <p className="text-xs font-semibold tracking-widest text-primary uppercase">{eyebrow}</p>}
      <DialogTitle className="font-display text-3xl font-bold tracking-wide md:text-4xl">{title}</DialogTitle>
      <DialogDescription>{children}</DialogDescription>
    </div>
  )
}

type ViewProps = {
  onViewChange: (view: AuthView) => void
}

/** Porta do cliente (com o nome da barbearia) × porta do sistema (painel). */
type DoorProps = { client?: boolean; shopName?: string }

function Sent({ title, children, onViewChange }: ViewProps & { title: string; children: ReactNode }) {
  return (
    <>
      <Header title={title}>{children}</Header>
      <Button variant="outline" className={SUBMIT_CLASS} onClick={() => onViewChange("entrar")}>
        Voltar para Entrar
      </Button>
    </>
  )
}

type LoginFormProps = ViewProps & DoorProps & {
  next: string
  notice?: string | null
}

export function LoginForm({ next, notice, onViewChange, client, shopName }: LoginFormProps) {
  const form = useAuthForm(
    (values) => validateLogin({ email: values.email, senha: values.senha }),
    (values) => signInWithPassword(values.email.trim(), values.senha)
  )

  return (
    <>
      <Header title="Entrar" eyebrow={client ? shopName : undefined}>
        {client ? "Entre para ver, reagendar e cancelar suas reservas." : "Acesse o painel da sua barbearia."}
      </Header>
      <FormAlert message={form.serverError ?? notice} />
      <Button variant="outline" className={`${SUBMIT_CLASS} animate-element animate-delay-200 gap-3`} disabled={form.pending} onClick={() => void form.run(() => signInWithGoogle(next))}>
        <GoogleIcon />
        Continuar com Google
      </Button>
      <div className="animate-element animate-delay-300 flex items-center gap-3 text-[13px] text-muted-foreground" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        ou
        <span className="h-px flex-1 bg-border" />
      </div>
      <form noValidate onSubmit={form.onSubmit} className="animate-element animate-delay-300 flex flex-col gap-4">
        <AuthInput label="Email" name="email" type="email" autoComplete="email" error={form.errors.email} />
        <AuthInput label="Senha" name="senha" type="password" autoComplete="current-password" error={form.errors.senha} />
        <div>
          <button type="button" className={TEXT_ACTION} onClick={() => onViewChange("recuperar")}>
            Esqueci minha senha
          </button>
        </div>
        <Button type="submit" className={SUBMIT_CLASS} disabled={form.pending}>
          {form.pending ? "Entrando…" : "Entrar"}
        </Button>
      </form>
      <p className="flex flex-wrap items-center justify-center gap-x-1 text-sm text-muted-foreground">
        Ainda não tem conta?
        <button type="button" className={TEXT_ACTION} onClick={() => onViewChange("criar-conta")}>
          Criar uma conta
        </button>
      </p>
      {!client && <p className="text-center text-xs text-muted-foreground">É cliente de uma barbearia? Entre pela página dela para ver suas reservas.</p>}
    </>
  )
}

export function SignUpForm({ next, onViewChange, client, shopName }: ViewProps & DoorProps & { next: string }) {
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null)
  const [existing, setExisting] = useState<string | null>(null)
  const form = useAuthForm(
    (values) => ({
      ...validateSignUp({ nome: values.nome, email: values.email, senha: values.senha, confirmacao: values.confirmacao }),
      // obrigatório: validatePhone aceita vazio (campos opcionais), então o vazio é recusado aqui
      ...((values.whatsapp ?? "").trim() && validatePhone(values.whatsapp) ? {} : { whatsapp: "Informe o WhatsApp com DDD, como +55 11 91234-5678." }),
    }),
    async (values) => {
      const email = values.email.trim()
      try {
        const result = await signUp({ nome: values.nome.trim(), email, senha: values.senha, whatsapp: phoneDigits(values.whatsapp) }, next)
        if ("alreadyRegistered" in result && result.alreadyRegistered) return setExisting(email)
        if (result.needsEmailConfirmation) setConfirmEmail(email)
      } catch (error) {
        const code = (error as { code?: string } | null)?.code
        if (code === "user_already_exists" || code === "email_exists") return setExisting(email)
        throw error
      }
    }
  )

  // E-mail que já tem conta: não cria outra; leva a entrar ou a recuperar a senha
  if (existing) {
    return (
      <>
        <Header title="Este e-mail já tem cadastro">
          Entre com a sua senha. Se não lembrar, recupere a senha: enviaremos um link para {existing}.
        </Header>
        <Button className={SUBMIT_CLASS} onClick={() => onViewChange("entrar")}>Entrar</Button>
        <Button variant="outline" className={SUBMIT_CLASS} onClick={() => onViewChange("recuperar")}>Recuperar senha</Button>
      </>
    )
  }

  if (confirmEmail) {
    return (
      <Sent title="Confirme seu email" onViewChange={onViewChange}>
        Enviamos um link de confirmação para {confirmEmail}. Abra o link para ativar a conta. Se não encontrar a mensagem, veja a caixa de spam.
      </Sent>
    )
  }

  return (
    <>
      <Header title="Criar conta" eyebrow={client ? shopName : undefined}>
        {client ? "Crie sua conta para reservar e acompanhar seus horários." : "Crie o acesso ao painel da sua barbearia."}
      </Header>
      <FormAlert message={form.serverError} />
      <form noValidate onSubmit={form.onSubmit} className="animate-element animate-delay-300 flex flex-col gap-4">
        <AuthInput label="Nome" name="nome" autoComplete="name" error={form.errors.nome} />
        <AuthInput label="Email" name="email" type="email" autoComplete="email" error={form.errors.email} />
        <AuthInput label="WhatsApp" name="whatsapp" type="tel" autoComplete="tel" error={form.errors.whatsapp} />
        <AuthInput label="Senha" name="senha" type="password" autoComplete="new-password" error={form.errors.senha} />
        <AuthInput label="Confirmar senha" name="confirmacao" type="password" autoComplete="new-password" error={form.errors.confirmacao} />
        <Button type="submit" className={SUBMIT_CLASS} disabled={form.pending}>
          {form.pending ? "Criando conta…" : "Criar conta"}
        </Button>
      </form>
      <p className="text-center">
        <button type="button" className={TEXT_ACTION} onClick={() => onViewChange("entrar")}>
          Já tenho uma conta
        </button>
      </p>
      {!client && <p className="text-center text-xs text-muted-foreground">É cliente de uma barbearia? Entre pela página dela para ver suas reservas.</p>}
    </>
  )
}

export function RecoverForm({ next, onViewChange }: ViewProps & { next: string }) {
  const [sentTo, setSentTo] = useState<string | null>(null)
  const form = useAuthForm(
    (values) => validateRecover({ email: values.email }),
    async (values) => {
      const email = values.email.trim()
      await requestPasswordReset(email, next)
      setSentTo(email)
    }
  )

  if (sentTo) {
    return (
      <Sent title="Verifique seu email" onViewChange={onViewChange}>
        Se houver uma conta para {sentTo}, enviaremos um link para definir a nova senha. Ele só chega no mesmo e-mail usado no cadastro (com o +apelido, se houver). Abra o link neste navegador. Se não encontrar a mensagem, veja a caixa de spam.
      </Sent>
    )
  }

  return (
    <>
      <Header title="Recuperar senha">Informe seu email para receber o link de recuperação.</Header>
      <FormAlert message={form.serverError} />
      <form noValidate onSubmit={form.onSubmit} className="animate-element animate-delay-300 flex flex-col gap-4">
        <AuthInput label="Email" name="email" type="email" autoComplete="email" error={form.errors.email} />
        <Button type="submit" className={SUBMIT_CLASS} disabled={form.pending}>
          {form.pending ? "Enviando…" : "Enviar instruções"}
        </Button>
      </form>
      <p className="text-center">
        <button type="button" className={TEXT_ACTION} onClick={() => onViewChange("entrar")}>
          Voltar para Entrar
        </button>
      </p>
    </>
  )
}

/** `area`: a sessão de recuperação é a da área que pediu o link (painel ou cliente). */
export function NewPasswordForm({ onDone, area }: { onDone: () => void; area: AuthArea }) {
  const form = useAuthForm(
    (values) => validateNewPassword({ senha: values.senha, confirmacao: values.confirmacao }),
    async (values) => {
      await updatePassword(values.senha, area)
      onDone()
    }
  )

  return (
    <form noValidate onSubmit={form.onSubmit} className="animate-element animate-delay-300 flex flex-col gap-4">
      <FormAlert message={form.serverError} />
      <AuthInput label="Nova senha" name="senha" type="password" autoComplete="new-password" error={form.errors.senha} />
      <AuthInput label="Confirmar senha" name="confirmacao" type="password" autoComplete="new-password" error={form.errors.confirmacao} />
      <Button type="submit" className={SUBMIT_CLASS} disabled={form.pending}>
        {form.pending ? "Salvando…" : "Salvar nova senha"}
      </Button>
    </form>
  )
}
