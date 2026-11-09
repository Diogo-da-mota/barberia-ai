import { ACCENTS, ACCENT_KEYS, type AccentChoice } from "@/lib/accent"
import { useAppearance } from "@/lib/appearance"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

/** Escolha da cor de destaque: um clique troca o site inteiro na hora (e guarda na conta). */
export function AccentPicker({ onPick, variant = "botoes" }: { onPick?: (choice: AccentChoice) => void; variant?: "botoes" | "bolinhas" }) {
  const { choice, setAccent } = useAppearance()
  const current = choice ?? "padrao"
  const pick = (next: AccentChoice) => { setAccent(next); onPick?.(next) }
  if (variant === "bolinhas") {
    const dot = "relative flex h-11 w-11 items-center justify-center rounded-full border-2 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card"
    const ring = (on: boolean) => (on ? "border-foreground" : "border-transparent")
    const all: { key: AccentChoice; label: string; background: string }[] = [
      ...ACCENT_KEYS.map((key) => ({ key: key as AccentChoice, label: ACCENTS[key].label, background: ACCENTS[key].primary })),
      { key: "padrao", label: "Padrão", background: `conic-gradient(${ACCENT_KEYS.map((k) => ACCENTS[k].primary).join(", ")}, ${ACCENTS[ACCENT_KEYS[0]].primary})` },
    ]
    return (
      <div role="group" aria-label="Cor de destaque" className="flex flex-wrap gap-3">
        {all.map(({ key, label, background }) => (
          <button key={key} type="button" aria-label={label} title={label} aria-pressed={current === key} onClick={() => pick(key)} className={cn(dot, ring(current === key))}>
            <span className="h-8 w-8 rounded-full" style={{ background }} aria-hidden="true" />
            {current === key && <Check className="absolute h-4 w-4 text-white drop-shadow" aria-hidden="true" />}
          </button>
        ))}
      </div>
    )
  }
  const base = "flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm transition-colors hover:bg-surface-alt md:min-h-10"
  return (
    <div role="group" aria-label="Cor de destaque" className="flex flex-wrap gap-2">
      <button type="button" aria-pressed={current === "padrao"} onClick={() => pick("padrao")} className={cn(base, current === "padrao" ? "border-primary bg-primary/10" : "border-border")}>Padrão</button>
      {ACCENT_KEYS.map((key) => (
        <button key={key} type="button" aria-pressed={current === key} onClick={() => pick(key)} className={cn(base, current === key ? "border-primary bg-primary/10" : "border-border")}>
          <span className="h-4 w-4 rounded-full border border-border" style={{ background: ACCENTS[key].primary }} aria-hidden="true" />{ACCENTS[key].label}
        </button>
      ))}
    </div>
  )
}
