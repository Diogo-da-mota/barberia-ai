/// <reference types="@testing-library/jest-dom/vitest" />
import { render } from "@testing-library/react"
import { Wallet } from "lucide-react"
import { describe, expect, it } from "vitest"
import { TabbedHeader, TabbedHeaderPhoto } from "./tabbed-header"

const header = (photo?: boolean | { src: string | null | undefined }) =>
  render(<TabbedHeader name="financeiro" icon={Wallet} title="Financeiro" description="Resumo" photo={photo} />).container

describe("foto do cabeçalho com abas (Financeiro)", () => {
  it("padrão, foto da barbearia ou nenhuma (compacto); carregando não pisca a padrão", () => {
    expect(header().querySelector("img")).toHaveAttribute("src", "/images/painel-topo.jpg")
    expect(header({ src: null }).querySelector("img")).toHaveAttribute("src", "/images/painel-topo.jpg")
    expect(header({ src: "https://x.test/loja-1/painel-financeiro.jpg?v=1" }).querySelector("img")).toHaveAttribute("src", "https://x.test/loja-1/painel-financeiro.jpg?v=1")
    expect(header({ src: undefined }).querySelector("img")).toBeNull()
    expect(header(false).querySelector("img")).toBeNull()
  })

  it("na página responde à tela como antes; na prévia do celular fixa as medidas do celular", () => {
    const page = render(<TabbedHeaderPhoto src={null} />).container.firstElementChild!
    expect(page).toHaveClass("max-h-[110px]", "sm:max-h-[130px]", "lg:max-h-[160px]", "[.dark_&]:block", "[.dark_&]:h-full")
    expect(page.querySelector("img")).toHaveClass("w-full", "opacity-45", "sm:w-[78%]", "sm:opacity-80", "lg:w-[66%]", "object-[60%_62%]")
    const phone = render(<TabbedHeaderPhoto src={null} phone />).container.firstElementChild!
    expect(phone).toHaveClass("max-h-[110px]")
    expect(phone.className).not.toMatch(/sm:|lg:/)
    expect(phone.querySelector("img")!.className).not.toMatch(/sm:|lg:/)
    expect(phone.querySelector("div")).toHaveClass("bg-gradient-to-t", "from-background", "via-background/40", "to-background/5")
  })
})
