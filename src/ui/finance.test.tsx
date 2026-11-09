/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DatePicker } from "./datepicker"
import { FinancialAmount } from "./finance"

describe("FinancialAmount", () => {
  it("renderiza despesa com sinal negativo e cor semântica", () => {
    render(<FinancialAmount value={-1500} />)
    expect(screen.getByText(/1\.500,00/)).toBeInTheDocument()
    expect(screen.getByText(/R\$/)).toBeInTheDocument()
  })

  it("renderiza receita com sinal positivo quando solicitado", () => {
    render(<FinancialAmount value={2500.5} sign="always" color="income" />)
    expect(screen.getByText(/2\.500,50/)).toBeInTheDocument()
    expect(screen.getByText(/\+/)).toBeInTheDocument()
  })
})

describe("DatePicker", () => {
  it("chama onChange com o valor selecionado", () => {
    const onChange = vi.fn()
    render(<DatePicker onChange={onChange} />)
    const input = screen.getByDisplayValue("") as HTMLInputElement
    fireEvent.input(input, { target: { value: "2026-11-06" } })
    expect(onChange).toHaveBeenCalledWith("2026-11-06")
  })

  it("aceita valor controlado", () => {
    render(<DatePicker value="2026-11-06" />)
    expect(screen.getByDisplayValue("2026-11-06")).toBeInTheDocument()
  })})
