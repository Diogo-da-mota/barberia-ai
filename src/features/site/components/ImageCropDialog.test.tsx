/// <reference types="@testing-library/jest-dom/vitest" />
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ImageCropDialog } from "./ImageCropDialog"

const file = new File([new Uint8Array([1, 2, 3])], "foto.png", { type: "image/png" })

describe("pop-up de recorte", () => {
  it("fechado sem arquivo; com arquivo mostra título, medida final, zoom e área de recorte", () => {
    const { rerender } = render(<ImageCropDialog file={null} kind="capa" onCancel={() => {}} onConfirm={() => {}} />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    rerender(<ImageCropDialog file={file} kind="capa" onCancel={() => {}} onConfirm={() => {}} />)
    expect(screen.getByRole("heading", { name: "Ajustar capa" })).toBeInTheDocument()
    expect(screen.getByText(/3:1 \(1800 × 600 px\)/)).toBeInTheDocument()
    expect(screen.getByRole("slider", { name: "Zoom" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: /Área de recorte da capa/ })).toHaveStyle({ aspectRatio: "3" })
  })

  it("a logo usa moldura quadrada 1:1", () => {
    render(<ImageCropDialog file={file} kind="logo" onCancel={() => {}} onConfirm={() => {}} />)
    expect(screen.getByText(/1:1 \(512 × 512 px\)/)).toBeInTheDocument()
    expect(screen.getByRole("group", { name: /Área de recorte da logo/ })).toHaveStyle({ aspectRatio: "1" })
  })

  it("só confirma depois da imagem carregar; Cancelar fecha sem enviar", () => {
    const onCancel = vi.fn(), onConfirm = vi.fn()
    render(<ImageCropDialog file={file} kind="logo" onCancel={onCancel} onConfirm={onConfirm} />)
    expect(screen.getByRole("button", { name: "Usar esta imagem" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
