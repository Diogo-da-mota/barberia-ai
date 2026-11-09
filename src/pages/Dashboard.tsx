import { Shell } from "@/app/Shell"

export function Dashboard() {
  return (
    <Shell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Início</h1>
        <p className="text-sm text-muted-foreground">
          Dashboard da barbearia: agenda, próximos atendimentos e indicadores.
        </p>
        <p className="text-sm text-muted-foreground">
          Telas de agenda serão implementadas nas fases F03–F05 do
          PLANO_IMPLEMENTACAO.md.
        </p>
      </div>
    </Shell>
  )
}
