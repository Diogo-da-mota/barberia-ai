import { useNavigate } from "react-router-dom"
import { useEffect, useState } from "react"
import { Button } from "@/ui/button"
import { signInWithGoogle } from "@/features/auth/services/auth"
import { useAuth } from "@/features/auth/hooks/useAuth"

export function Login() {
  const navigate = useNavigate()
  const { session, loading } = useAuth()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && session) {
      navigate("/", { replace: true })
    }
  }, [loading, session, navigate])

  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
        <div className="flex w-full max-w-md flex-col items-center justify-center gap-4 p-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold">Entrando…</h2>
        </div>
      </div>
  )
  }

  if (session) {
    return null
  }

  const handleGoogleLogin = async () => {
    setError(null)
    try {
      await signInWithGoogle()
    } catch (error) {
      // Mensagem sem detalhes internos (Segurança.md)
      console.error("Falha ao iniciar login com o Google", error)
      setError(
        "Não foi possível iniciar o login com o Google. Verifique se a URL de redirecionamento está configurada no Supabase e no Google Cloud Console."
      )
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-md flex-col items-center justify-center gap-4 p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold">Entrar com o Google</h2>
        <p className="text-sm text-muted-foreground text-center">
          A autenticação usa Supabase Auth com Google OAuth (F02-01).
        </p>
        {error && (
          <p className="text-xs text-danger text-center" role="alert">
            {error}
          </p>
        )}
        <Button
          onClick={handleGoogleLogin}
          variant="default"
          className="w-full"
          disabled={false}
        >
          Continuar com o Google
        </Button>
        <div className="mt-4 w-full">
          <Button onClick={() => navigate("/")} variant="ghost" className="w-full">
            Ir para o painel (sem sessão)
          </Button>
        </div>
      </div>
    </div>
  )
}
