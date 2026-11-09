import { useNavigate } from "react-router-dom"
import { Button } from "@/ui/button"
import { EmptyState } from "@/ui/finance"
import { Shell } from "@/app/Shell"

type PlaceholderProps = {
  title: string
  description?: string
  href?: string
  actionLabel?: string
  public?: boolean
}

export function Placeholder({
  title,
  description,
  href,
  actionLabel,
  public: isPublic = false,
}: PlaceholderProps) {
  const navigate = useNavigate()

  if (isPublic) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
        <EmptyState
          title={title}
          description={description}
          action={
            actionLabel && href ? (
              <Button
                onClick={() => navigate(href)}
                variant="default"
                className="w-full sm:w-auto"
              >
                {actionLabel}
              </Button>
            ) : null
          }
        />
      </div>
    )
  }

  return (
    <Shell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        <EmptyState
          title="Em desenvolvimento"
          description="Esta tela será implementada nas próximas fases do PLANO_IMPLEMENTACAO.md."
          action={
            actionLabel && href ? (
              <Button
                onClick={() => navigate(href)}
                variant="default"
              >
                {actionLabel}
              </Button>
            ) : null
          }
        />
      </div>
    </Shell>
  )
}
