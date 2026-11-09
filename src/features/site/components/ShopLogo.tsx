import { Store } from "lucide-react"
import { cn } from "@/lib/utils"

/** Logo da barbearia em miniatura (cantos arredondados). Sem logo, o ícone de loja. */
export function ShopLogo({ url, className }: { url: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" className={cn("h-8 w-8 shrink-0 rounded-lg object-cover", className)} />
  ) : (
    <span aria-hidden="true" className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary", className)}>
      <Store className="h-4 w-4" />
    </span>
  )
}
