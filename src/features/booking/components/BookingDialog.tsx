import type { ReactNode } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog"
import { Users } from "lucide-react"
import { ProfessionalCard } from "@/features/catalog/components/ProfessionalCard"

/** Pop-up da reserva: abre ao clicar em Reservar e reúne profissional, dia e horário, e os dados. */
export function BookingDialog({ open, onOpenChange, serviceName, children }: { open: boolean; onOpenChange: (open: boolean) => void; serviceName: string; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-2rem)] max-w-[680px] overflow-y-auto bg-card [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] p-4 sm:p-6">
        <div className="flex flex-col gap-1.5 pr-8 text-left">
          <DialogTitle className="font-display text-2xl font-bold tracking-wide">Reservar {serviceName}</DialogTitle>
          <DialogDescription>Escolha o profissional, o dia e o horário livre.</DialogDescription>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  )
}

export type ProfessionalItem = { id: string; nome: string; avatarPath: string | null }

/** Profissionais em cards (foto à esquerda, como no painel). "Qualquer profissional" é a primeira opção. */
export function ProfessionalChoice({ items, selected, onSelect }: { items: ProfessionalItem[]; selected: string; onSelect: (id: string) => void }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-label="Profissionais">
      {items.map((item) => {
        const active = item.id === selected
        return (
          <li key={item.id} className="flex">
            <button type="button" aria-pressed={active} onClick={() => onSelect(item.id)} className="flex w-full rounded-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <ProfessionalCard
                nome={item.nome} photoPath={item.avatarPath} selected={active}
                photoFallback={item.id === "any" ? <Users className="h-10 w-10" aria-hidden="true" /> : undefined}
                className="items-center"
              />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
