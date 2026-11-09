import { cn } from "@/lib/utils"

export const categoryColors = [
  "cat-blue",
  "cat-orange",
  "cat-aqua",
  "cat-yellow",
  "cat-magenta",
  "cat-green",
  "cat-violet",
  "cat-red",
  "cat-slate",
] as const

export type CategoryColor = (typeof categoryColors)[number]

export function categoryIconColor(index: number): CategoryColor {
  return categoryColors[index % categoryColors.length]
}

export function CategoryIcon({
  className,
  color = "cat-slate",
  size = 5,
  children,
}: {
  className?: string
  color?: CategoryColor
  size?: number
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-lg",
        `bg-${color}`,
        className
      )}
      style={{ fontSize: size }}
    >
      {children}
    </div>
  )
}
