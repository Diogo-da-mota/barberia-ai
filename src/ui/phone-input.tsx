import * as React from "react"
import { PHONE_PLACEHOLDER, formatPhone } from "@/lib/br"
import { cn } from "@/lib/utils"

/**
 * Campo de telefone/WhatsApp do site inteiro. O +55 é fixo: digite só DDD e número.
 * Mostra sempre +55 00 00000-0000 (celular) ou +55 00 0000-0000 (fixo). Informa o texto já formatado;
 * para enviar ao servidor use phoneDigits() de `@/lib/br`.
 */
export function PhoneInput({
  className,
  defaultValue = "",
  onValueChange,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type"> & {
  defaultValue?: string
  onValueChange?: (formatted: string) => void
}) {
  const [value, setValue] = React.useState(() => formatPhone(defaultValue))
  return (
    <input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder={props.placeholder ?? PHONE_PLACEHOLDER}
      value={value}
      onChange={(event) => {
        const formatted = formatPhone(event.target.value)
        setValue(formatted)
        onValueChange?.(formatted)
      }}
      className={cn(
        "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base tabular-nums placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:text-sm",
        className,
      )}
      {...props}
    />
  )
}
