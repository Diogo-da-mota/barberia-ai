import { cn } from "@/lib/utils"

/**
 * Seletor de data curto (Design System: seções 4, 13 e 14).
 * Input nativo type="date" com fallback de texto; label sempre visível.
 */
export function DatePicker({
  className,
  value,
  onChange,
  ...props
}: {
  className?: string
  value?: string
  onChange?: (value: string) => void
  [key: string]: unknown
}) {
  return (
    <input
      type="date"
      className={cn(
        "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
      {...props}
    />
  )
}
