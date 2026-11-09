import * as React from "react"

import { cn } from "@/lib/utils"
import { centsFromTyping, formatMoneyInput } from "@/lib/money"
import { type CategoryColor } from "./category-look"

type FinancialAmountProps = {
  value: number
  className?: string
  sign?: "auto" | "always" | "never"
  color?: "income" | "expense" | "inherit"
}

export function FinancialAmount({
  value,
  className,
  sign = "auto",
  color = "inherit",
}: FinancialAmountProps) {
  const isNegative = value < 0
  const abs = Math.abs(value)
  const showSign =
    sign === "always" ||
    (sign === "auto" && (isNegative || color === "income"))

  let resolvedColor = color
  if (resolvedColor === "inherit") {
    resolvedColor = isNegative ? "expense" : "income"
  }

  const formatted = new Intl.NumberFormat("pt-BR", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs)

  return (
    <span
      className={cn(
        "font-display font-semibold text-foreground tabular-nums",
        `text-${resolvedColor}`,
        className
      )}
    >
      {showSign && !isNegative ? "+" : ""}
      R$ {formatted}
    </span>
  )
}

/**
 * Campo de valor em reais. Digite só números: o valor entra pela direita e o formato
 * (00,00 · 1.000,00) é mantido sozinho. Sempre informa o valor em centavos (null quando vazio).
 */
export function MoneyInput({
  className,
  defaultCents = null,
  onCentsChange,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange"> & {
  defaultCents?: number | null
  onCentsChange?: (cents: number | null) => void
}) {
  const [cents, setCents] = React.useState<number | null>(defaultCents)
  const change = (next: number | null) => {
    setCents(next)
    onCentsChange?.(next)
  }
  const text = cents === null || cents === 0 ? "" : formatMoneyInput(cents)
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={text}
      placeholder={props.placeholder ?? "00,00"}
      onChange={(event) => {
        const typed = centsFromTyping(event.target.value)
        change(typed === 0 ? null : typed)
      }}
      className={cn(
        "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base font-display tabular-nums placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

type FieldProps = {
  label: string
  htmlFor?: string
  error?: string
  errorId?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}

export function Field({
  label,
  htmlFor,
  error,
  errorId,
  required,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
        {label}{required ? <span className="text-expense ml-0.5">*</span> : null}
      </label>
      {children}
      {error && (
        <p id={errorId} className="text-[13px] text-expense">{error}</p>
      )}
    </div>
  )
}

type PageProps = { children: React.ReactNode; className?: string }

export function Page({ children, className }: PageProps) {
  return (
    <div className={cn("mx-auto w-full p-4 sm:p-6", className)}>{children}</div>
  )
}

type PanelProps = {
  variant?: "default" | "highlight" | "editorial"
  className?: string
  children: React.ReactNode
}

export function Panel({
  variant = "default",
  className,
  children,
}: PanelProps) {
  return (
    <div
      className={cn(
        "border border-border bg-card text-foreground shadow-sm overflow-hidden",
        {
          default: "rounded-card",
          highlight: "rounded-card ring-1 ring-primary/20",
          editorial: "rounded-[20px_6px_20px_6px]",
        }[variant ?? "default"],
        className
      )}
    >
      {children}
    </div>
  )
}

type IconBlockProps = {
  size?: "sm" | "md" | "lg"
  className?: string
  children: React.ReactNode
}

export function IconBlock({
  size = "md",
  className,
  children,
}: IconBlockProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md",
        {
          sm: "h-8 w-8",
          md: "h-10 w-10",
          lg: "h-12 w-12",
        }[size],
        className
      )}
    >
      {children}
    </div>
  )
}

type ListRowProps = {
  className?: string
  children: React.ReactNode
}

export function ListRow({ className, children }: ListRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border border-transparent bg-background p-3 hover:bg-surface-alt",
        className
      )}
    >
      {children}
    </div>
  )
}

type StatusBadgeProps = {
  variant: "default" | "income" | "expense" | "warning" | "danger" | "info"
  className?: string
  children: React.ReactNode
}

export function StatusBadge({
  variant = "default",
  className,
  children,
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors",
        {
          default: "border-border bg-surface-alt text-muted-foreground",
          income: "border-income/20 bg-income/10 text-income",
          expense: "border-expense/20 bg-expense/10 text-expense",
          warning: "border-warning/20 bg-warning/10 text-warning",
          danger: "border-danger/20 bg-danger/10 text-danger",
          info: "border-info/20 bg-info/10 text-info",
        }[variant],
        className
      )}
    >
      {children}
    </span>
  )
}

type OverdraftBadgeProps = {
  className?: string
  children?: React.ReactNode
}

export function OverdraftBadge({
  className,
  children,
}: OverdraftBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-danger bg-danger/10 text-danger px-2.5 py-0.5 text-xs font-medium",
        className
      )}
    >
      {children}
    </span>
  )
}

type EmptyStateProps = {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 text-center p-8", className)}
    >
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

type CategoryIconProps = {
  color?: CategoryColor
  size?: number
  className?: string
  children?: React.ReactNode
}

export function CategoryIcon({
  color = "cat-slate",
  size = 5,
  className,
  children,
}: CategoryIconProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        `bg-${color}`,
        className
      )}
      style={{ fontSize: size }}
    >
      {children}
    </div>
  )
}
