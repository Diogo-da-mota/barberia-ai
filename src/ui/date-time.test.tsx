/// <reference types="@testing-library/jest-dom/vitest" />
import { fireEvent, render, screen, within } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it } from "vitest"
import { DateField, DateTimeField, MonthField, TimeField, formatDateBR, formatMonthBR, parseDate, toDateValue } from "./date-time"

function Demo({ kind, initial }: { kind: "date" | "month" | "time" | "datetime"; initial: string }) {
  const [v, setV] = useState(initial)
  const common = { value: v, onChange: setV, "aria-label": "Campo" }
  return (
    <>
      {kind === "date" && <DateField {...common} />}
      {kind === "month" && <MonthField {...common} />}
      {kind === "time" && <TimeField {...common} clearable />}
      {kind === "datetime" && <DateTimeField {...common} name="quando" />}
      <output data-testid="valor">{v}</output>
    </>
  )
}
const valor = () => screen.getByTestId("valor").textContent

describe("campos de data e hora (shadcn)", () => {
  it("converte e formata sem mexer no fuso: 2026-11-06 ↔ 06/11/2026 ↔ novembro de 2026", () => {
    expect(formatDateBR("2026-11-06")).toBe("06/11/2026")
    expect(formatMonthBR("2026-11")).toBe("novembro de 2026")
    expect(toDateValue(parseDate("2026-01-31")!)).toBe("2026-01-31")
  })

  it("data: mostra no formato brasileiro, abre o calendário ao clicar e escolhe o dia", () => {
    render(<Demo kind="date" initial="2026-11-06" />)
    expect(screen.getByRole("button", { name: "Campo" })).toHaveTextContent("06/11/2026")
    fireEvent.click(screen.getByRole("button", { name: "Campo" }))
    fireEvent.click(screen.getByRole("button", { name: /15 de novembro/i }))
    expect(valor()).toBe("2026-11-15")
    expect(screen.getByRole("button", { name: "Campo" })).toHaveTextContent("15/11/2026")
  })

  it("mês: grade de meses com troca de ano", () => {
    render(<Demo kind="month" initial="2026-11" />)
    expect(screen.getByRole("button", { name: "Campo" })).toHaveTextContent("novembro de 2026")
    fireEvent.click(screen.getByRole("button", { name: "Campo" }))
    fireEvent.click(screen.getByRole("button", { name: "Próximo ano" }))
    fireEvent.click(screen.getByRole("button", { name: "mar" }))
    expect(valor()).toBe("2027-03")
  })

  it("hora: escolhe hora e minutos em colunas e pode limpar", () => {
    render(<Demo kind="time" initial="09:00" />)
    fireEvent.click(screen.getByRole("button", { name: "Campo" }))
    fireEvent.click(within(screen.getByRole("listbox", { name: "Hora" })).getByRole("option", { name: "14" }))
    fireEvent.click(within(screen.getByRole("listbox", { name: "Minutos" })).getByRole("option", { name: "30" }))
    expect(valor()).toBe("14:30")
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }))
    expect(valor()).toBe("")
  })

  it("data e hora: calendário e horário no mesmo pop-up, e o valor segue no formulário", () => {
    const { container } = render(<Demo kind="datetime" initial="2026-11-06T09:00" />)
    expect(screen.getByRole("button", { name: "Campo" })).toHaveTextContent("06/11/2026 09:00")
    fireEvent.click(screen.getByRole("button", { name: "Campo" }))
    fireEvent.click(screen.getByRole("button", { name: /20 de novembro/i }))
    fireEvent.click(within(screen.getByRole("listbox", { name: "Hora" })).getByRole("option", { name: "16" }))
    expect(valor()).toBe("2026-11-20T16:00")
    expect(container.querySelector('input[name="quando"]')).toHaveValue("2026-11-20T16:00")
  })
})
