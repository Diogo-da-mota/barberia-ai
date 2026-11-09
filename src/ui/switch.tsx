import { cn } from "@/lib/utils"

type SwitchProps = {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  className?: string
  "aria-label"?: string
  "aria-describedby"?: string
}

/** Chave liga/desliga (role="switch"). Área de toque de 44 px; trilho na cor de destaque quando ligada. */
export function Switch({ checked, onCheckedChange, disabled, className, ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "group inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 md:h-10",
        className,
      )}
      {...aria}
    >
      <span aria-hidden="true" className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors", checked ? "bg-primary" : "bg-muted-foreground/40")}>
        <span className={cn("block h-5 w-5 rounded-full bg-background shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
      </span>
    </button>
  )
}
