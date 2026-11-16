/// <reference types="@testing-library/jest-dom/vitest" />
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { HeroPhoto, SidebarPhoto } from "./PanelPhotos"

const imgOf = (node: React.ReactElement) => render(<div>{node}</div>).container.querySelector("img")

describe("fotos do painel (mesmo componente no painel e na prévia de Meu site › Fotos)", () => {
  it("sem foto própria usa a padrão; com foto própria usa a da barbearia; carregando não pisca a padrão", () => {
    expect(imgOf(<SidebarPhoto src={null} />)).toHaveAttribute("src", "/images/painel-menu.jpg")
    expect(imgOf(<HeroPhoto src={null} />)).toHaveAttribute("src", "/images/painel-topo.jpg")
    expect(imgOf(<SidebarPhoto src="https://x.test/m.jpg?v=2" />)).toHaveAttribute("src", "https://x.test/m.jpg?v=2")
    expect(imgOf(<HeroPhoto src="https://x.test/t.jpg?v=2" />)).toHaveAttribute("src", "https://x.test/t.jpg?v=2")
    expect(imgOf(<SidebarPhoto src={undefined} />)).toBeNull()
    expect(imgOf(<HeroPhoto src={undefined} />)).toBeNull()
  })

  it("mantém o enquadramento e os degradês de antes (menu: 3; topo do Início: 2, em 440 px)", () => {
    const menu = render(<div><SidebarPhoto src={null} /></div>).container.firstElementChild!
    expect(menu.querySelector("img")).toHaveClass("object-cover", "object-center", "opacity-80")
    expect([...menu.querySelectorAll(":scope > div")].map((d) => d.className)).toEqual([
      "absolute inset-0 bg-gradient-to-b from-card via-card/70 to-transparent",
      "absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent",
      "absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-card/80 to-transparent",
    ])
    const hero = render(<HeroPhoto src={null} />).container.firstElementChild!
    expect(hero).toHaveClass("pointer-events-none", "absolute", "inset-x-0", "top-0", "h-[440px]", "overflow-hidden")
    expect(hero.querySelector("img")).toHaveClass("object-cover", "object-[center_40%]", "opacity-60")
    expect([...hero.querySelectorAll(":scope > div")].map((d) => d.className)).toEqual([
      "absolute inset-0 bg-gradient-to-r from-background via-background/70 to-transparent",
      "absolute inset-0 bg-gradient-to-b from-background/30 via-transparent to-background",
    ])
  })
})
