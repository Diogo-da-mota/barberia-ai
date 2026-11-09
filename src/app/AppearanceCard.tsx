import { Check, Moon, Sun } from "lucide-react"
import { useTheme } from "@/lib/theme"
import { AccentPicker } from "@/ui/accent-picker"
import { Panel } from "@/ui/finance"
import { cn } from "@/lib/utils"

/** Aparência da conta: modo claro/escuro e cor de destaque. Muda na hora em todo o site e fica na conta do usuário. */
export function AppearanceCard() {
  const { theme, setTheme } = useTheme()
  const modes = [{ id: "light" as const, label: "Claro", Icon: Sun }, { id: "dark" as const, label: "Escuro", Icon: Moon }]
  return (
    <Panel className="flex flex-col gap-5 p-4 sm:p-5">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-wide">Aparência</h2>
        <p className="text-sm text-muted-foreground">Vale para o site inteiro (página pública e painel) e fica salva na sua conta. A mudança é imediata.</p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Modo</p>
        <div role="radiogroup" aria-label="Modo" className="grid max-w-md grid-cols-2 gap-3">
          {modes.map(({ id, label, Icon }) => (
            <button key={id} type="button" role="radio" aria-checked={theme === id} onClick={() => setTheme(id)}
              className={cn("flex min-h-14 items-center gap-3 rounded-card border bg-card px-4 text-left text-sm font-semibold transition-colors hover:bg-surface-alt", theme === id ? "border-primary ring-2 ring-primary/40" : "border-border")}>
              <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-alt"><Icon className="h-4 w-4" /></span>
              <span className="flex-1">{label}</span>
              {theme === id && <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary"><Check className="h-3 w-3" aria-hidden="true" />Ativo</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Cor de destaque</p>
        <AccentPicker />
      </div>
    </Panel>
  )
}
