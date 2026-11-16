import { useState } from "react"
import { Bot, X } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover"
import { AssistantChat } from "./AssistantChat"

/** Lara em todas as telas do painel (gestão): botão no canto inferior direito que abre a mesma conversa de Configurações › Assistente. */
export function LaraLauncher({ shopId }: { shopId: string }) {
  const [open, setOpen] = useState(false)
  const Icon = open ? X : Bot
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={open ? "Fechar a Lara" : "Conversar com a Lara"}
          className="fixed right-4 bottom-20 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_24px_-6px_rgb(0_0_0/0.5)] transition-[transform,background-color] duration-200 ease-out hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 md:right-6 md:bottom-6"
        >
          <Icon className="h-6 w-6" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      {/* sobe do botão; acima da barra inferior do celular (bottom-20). O foco vai para o campo da pergunta, não para o "fechar". */}
      <PopoverContent
        side="top"
        align="end"
        sideOffset={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[400px] origin-bottom-right animate-[lara-in_220ms_cubic-bezier(0.16,1,0.3,1)] border-0 bg-transparent shadow-none"
      >
        <AssistantChat shopId={shopId} onClose={() => setOpen(false)} className="shadow-[0_16px_48px_-12px_rgb(0_0_0/0.55)]" />
      </PopoverContent>
    </Popover>
  )
}
