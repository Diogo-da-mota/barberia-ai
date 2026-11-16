/// <reference types="@testing-library/jest-dom/vitest" />
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("./AuthForms", () => ({ LoginForm: () => <p>formulário</p>, SignUpForm: () => null, RecoverForm: () => null }))

import { AuthDialog } from "./AuthDialog"

const photoOf = (client: boolean, photo: string | null) => {
  const view = render(<AuthDialog open view="entrar" next="/barbearia" notice={null} onViewChange={() => {}} onClose={() => {}} client={client} shopName="Barbearia do Tico" photo={photo} />)
  const value = document.querySelector("[data-photo]")!.getAttribute("data-photo")
  view.unmount()
  return value
}

describe("foto do acesso (pop-up de login)", () => {
  it("porta do cliente usa a foto da barbearia; sem foto, a padrão", () => {
    expect(photoOf(true, "https://x.test/loja-1/painel-login-cliente.jpg?v=1")).toBe("https://x.test/loja-1/painel-login-cliente.jpg?v=1")
    expect(photoOf(true, null)).toMatch(/^https:\/\/images\.unsplash\.com\//)
  })

  it("o login da equipe (porta do sistema) nunca usa a foto da barbearia", () => {
    expect(photoOf(false, "https://x.test/loja-1/painel-login-cliente.jpg?v=1")).toMatch(/^https:\/\/images\.unsplash\.com\//)
  })
})
