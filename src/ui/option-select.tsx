import type { ReactNode } from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectTrigger } from "./select"

export type Option = { value: string; label: string; icon?: ReactNode }

/**
 * Lista suspensa (shadcn Select) com ícone opcional em cada opção. A lista abre SEMPRE abaixo do campo,
 * com a mesma largura dele. Substitui o `<select>` nativo em todo o sistema.
 */
export function OptionSelect({ id, value, onValueChange, options, placeholder = "Selecionar", className, disabled, "aria-label": ariaLabel }: {
  id?: string
  value: string
  onValueChange: (value: string) => void
  options: Option[]
  placeholder?: string
  className?: string
  disabled?: boolean
  "aria-label"?: string
}) {
  const selected = options.find((o) => o.value === value)
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn("h-11 gap-2 text-base md:h-10 md:text-sm", className)}>
        <span className="flex min-w-0 items-center gap-2">
          {selected?.icon && <span aria-hidden="true" className="shrink-0 text-primary">{selected.icon}</span>}
          <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
        </span>
      </SelectTrigger>
      <SelectContent sideOffset={6} className="w-[var(--radix-select-trigger-width)] p-1">
        {options.map((option) => (
          <SelectPrimitive.Item
            key={option.value}
            value={option.value}
            className="flex min-h-11 cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 text-sm outline-none data-[highlighted]:bg-surface-alt data-[state=checked]:font-semibold md:min-h-10"
          >
            {option.icon && <span aria-hidden="true" className="shrink-0 text-primary">{option.icon}</span>}
            <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
            <SelectPrimitive.ItemIndicator className="ml-auto"><Check className="h-4 w-4" aria-hidden="true" /></SelectPrimitive.ItemIndicator>
          </SelectPrimitive.Item>
        ))}
      </SelectContent>
    </Select>
  )
}
