/// <reference types="@testing-library/jest-dom/vitest" />
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SiteGallery, SiteHero } from "./SiteTemplate"

const base = { nome: "Barbearia do Tico", descricao: "Cortes clássicos.", endereco: "Rua A, 10", telefone: "11999990000", capaUrl: null, logoUrl: null }

describe("template padrão do site", () => {
  it("mostra nome como título, descrição, endereço e telefone", () => {
    render(<SiteHero {...base} />)
    expect(screen.getByRole("heading", { level: 1, name: "Barbearia do Tico" })).toBeInTheDocument()
    expect(screen.getByText("Cortes clássicos.")).toBeInTheDocument()
    expect(screen.getByText("Rua A, 10")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "+55 11 99999-0000" })).toHaveAttribute("href", "tel:+5511999990000")
  })

  it("sem logo usa a inicial; sem capa não quebra; com imagens mostra capa e logo", () => {
    const { rerender } = render(<SiteHero {...base} />)
    expect(screen.getByTestId("site-logo-fallback")).toHaveTextContent("B")
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    rerender(<SiteHero {...base} capaUrl="https://x.test/capa.png" logoUrl="https://x.test/logo.png" />)
    expect(screen.getByRole("img", { name: "Capa de Barbearia do Tico" })).toHaveAttribute("src", "https://x.test/capa.png")
    expect(screen.getByRole("img", { name: "Logo de Barbearia do Tico" })).toBeInTheDocument()
    expect(screen.queryByTestId("site-logo-fallback")).not.toBeInTheDocument()
  })

  it("na pré-visualização o título vira nível 2 (a página só tem um h1) e campos vazios somem", () => {
    render(<SiteHero {...base} descricao={null} endereco={null} telefone={null} headingLevel={2} />)
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 2, name: "Barbearia do Tico" })).toBeInTheDocument()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("a galeria lista as fotos e some quando vazia", () => {
    const { container, rerender } = render(<SiteGallery nome="Tico" urls={["a.png", "b.png"]} />)
    expect(screen.getAllByRole("img")).toHaveLength(2)
    expect(screen.getByRole("img", { name: "Foto 2 de Tico" })).toBeInTheDocument()
    rerender(<SiteGallery nome="Tico" urls={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
