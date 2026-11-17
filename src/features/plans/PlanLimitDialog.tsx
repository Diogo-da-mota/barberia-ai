import { Button } from "@/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog"
import { WhatsAppIcon } from "@/ui/whatsapp-icon"
import { planLimitWhatsAppUrl } from "./domain"

/** Pop-up de limite de profissionais do plano: explica e abre o WhatsApp do desenvolvedor com a mensagem pronta. */
export function PlanLimitDialog({ open, onOpenChange, shopName, max }: { open: boolean; onOpenChange: (open: boolean) => void; shopName: string; max: number | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md gap-4">
        <DialogTitle className="font-display text-xl font-bold">Limite de profissionais atingido</DialogTitle>
        <DialogDescription>
          {`Sua barbearia atingiu o limite de ${max === null ? "" : `${max} `}profissionais. Para aumentar a capacidade da equipe, entre em contato com o desenvolvedor.`}
        </DialogDescription>
        <Button asChild className="h-11 gap-2 md:h-10">
          <a href={planLimitWhatsAppUrl(shopName)} target="_blank" rel="noreferrer">
            <WhatsAppIcon className="h-5 w-5" />
            Conversar pelo WhatsApp
          </a>
        </Button>
      </DialogContent>
    </Dialog>
  )
}
