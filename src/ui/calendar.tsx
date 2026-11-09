import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker, type DayPickerProps } from "react-day-picker"
import { ptBR } from "date-fns/locale"
import { cn } from "@/lib/utils"

/**
 * Calendário no padrão shadcn/ui (react-day-picker), em português e com as cores do Design System.
 * Use `mode="single"` com `selected`/`onSelect`, como no DayPicker.
 */
export function Calendar({ className, classNames, showOutsideDays = true, ...props }: DayPickerProps) {
  return (
    <DayPicker
      locale={ptBR}
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        root: "relative",
        months: "flex flex-col gap-4",
        month: "flex flex-col gap-4",
        month_caption: "flex h-9 items-center justify-center font-display text-base font-semibold capitalize",
        nav: "absolute inset-x-3 top-3 flex items-center justify-between",
        button_previous: "inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-foreground hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40",
        button_next: "inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-foreground hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-10 pb-1 text-center text-[13px] font-medium capitalize text-muted-foreground",
        week: "mt-1 flex w-full",
        day: "relative p-0 text-center text-sm",
        day_button: "h-10 w-10 rounded-md text-sm font-medium tabular-nums transition-colors hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:text-muted-foreground/50",
        selected: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
        today: "[&>button]:border [&>button]:border-primary",
        outside: "text-muted-foreground/60",
        disabled: "text-muted-foreground/50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => (orientation === "left" ? <ChevronLeft className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />),
      }}
      {...props}
    />
  )
}
