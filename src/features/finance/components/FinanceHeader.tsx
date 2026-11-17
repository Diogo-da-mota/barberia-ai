import { ChevronLeft, ChevronRight, Wallet } from "lucide-react"
import { addMonths } from "@/features/booking/domain"
import { Button } from "@/ui/button"
import { useActiveBarbershop } from "@/features/catalog/hooks/useActiveBarbershop"
import { usePanelPhoto } from "@/features/site/hooks/usePanelPhoto"
import { MonthField } from "@/ui/date-time"
import { TabbedHeader } from "@/ui/tabbed-header"

export const FINANCE_TABS = [
  { value: "resumo", label: "Resumo" },
  { value: "pagamentos", label: "Pagamentos" },
  { value: "comissoes", label: "Comissões" },
  { value: "repasses", label: "Repasses" },
  { value: "despesas", label: "Despesas" },
] as const

/** Cabeçalho do Financeiro: o cabeçalho com abas compartilhado, mais o seletor de mês nas abas que dependem do mês. Sem `tabs`, só o título (barbeiro). */
export function FinanceHeader({ tabs, showMonth, month, onMonth, photo }: { tabs: boolean; showMonth: boolean; month: string; onMonth: (ym: string) => void; /** Prévia de Meu site › Fotos: esta foto no lugar da salva. */ photo?: string | null }) {
  const gate = useActiveBarbershop()
  const saved = usePanelPhoto(gate.state === "ready" ? gate.active?.id : null, "financeiro")
  return (
    <TabbedHeader
      photo={{ src: photo === undefined ? saved : photo }}
      name="financeiro" icon={Wallet} title="Financeiro" description="Controle de pagamentos, comissões, repasses e despesas da barbearia."
      tabs={tabs ? FINANCE_TABS : undefined}
      right={showMonth && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 bg-card/90 md:h-10 md:w-10" aria-label="Mês anterior" onClick={() => onMonth(addMonths(`${month}-01`, -1).slice(0, 7))}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
          <label className="flex min-w-0 items-center gap-3 text-sm font-medium">
            <span className="sr-only">Mês</span>
            <MonthField value={month} onChange={onMonth} className="min-w-44 bg-card/90" aria-label="Mês" />
          </label>
          <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 bg-card/90 md:h-10 md:w-10" aria-label="Próximo mês" onClick={() => onMonth(addMonths(`${month}-01`, 1).slice(0, 7))}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
      )}
    />
  )
}
