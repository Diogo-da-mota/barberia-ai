import { useNavigate } from "react-router-dom"
import { Button } from "@/ui/button"
import { EmptyState } from "@/ui/finance"

export function Login() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
      <EmptyState
        title="Entrar com o Google"
        description="A autenticação via Supabase Auth + Google OAuth será configurada na Fase 02."
        action={
          <Button
            onClick={() => navigate("/")}
            variant="default"
            className="w-full sm:w-auto"
          >
            Ir para o painel
          </Button>
        }
      />
    </div>
  )
}
