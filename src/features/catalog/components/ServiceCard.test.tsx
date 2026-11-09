/// <reference types="@testing-library/jest-dom/vitest" />
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ServiceCard } from "./ServiceCard"

const service = { id: "s1", nome: "Corte de Cabelo", descricao: "Estilo personalizado", preco_centavos: 5000, duracao_min: 40, ativo: true }

describe("ServiceCard (mesmo visual no painel e na página pública)", () => {
  it("mostra foto, nome, descrição, preço e duração", () => {
    render(<ServiceCard service={service} photos={["https://x.test/corte.jpg"]} action={<button>Reservar</button>} />)
    expect(screen.getByText("Corte de Cabelo")).toBeInTheDocument()
    expect(screen.getByText("Estilo personalizado")).toBeInTheDocument()
    expect(screen.getByText("R$ 50,00")).toBeInTheDocument()
    expect(screen.getByText("40 min")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reservar" })).toBeInTheDocument()
    // foto decorativa: o nome do serviço já é lido pelo texto do card
    expect(document.querySelector("img")).toHaveAttribute("src", "https://x.test/corte.jpg")
    expect(document.querySelector("img")).toHaveAttribute("alt", "")
  })

  it("com várias fotos mostra setas, pontinhos e o contador de fotos", () => {
    render(<ServiceCard service={service} photos={["a.jpg", "b.jpg", "c.jpg"]} action={null} />)
    expect(screen.getByRole("button", { name: "Próxima foto" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Foto anterior" })).toBeInTheDocument()
    expect(screen.getByLabelText("Foto 1 de 3")).toBeInTheDocument()
    expect(document.querySelectorAll("img")).toHaveLength(3)
  })

  it("sem foto mostra um quadro padrão, e o card continua igual", () => {
    render(<ServiceCard service={service} photos={[]} action={<button>Reservar</button>} />)
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.getByTestId("service-photo-fallback")).toBeInTheDocument()
  })

  it("marca o inativo com aviso e avisa quando está selecionado", () => {
    const { rerender } = render(<ServiceCard service={{ ...service, ativo: false }} photos={[]} action={null} selected />)
    expect(screen.getByText("Inativo")).toBeInTheDocument()
    expect(screen.getByTestId("service-card")).toHaveAttribute("data-selected", "true")
    rerender(<ServiceCard service={service} photos={[]} action={null} />)
    expect(screen.getByTestId("service-card")).toHaveAttribute("data-selected", "false")
  })

  it("no painel as ações ficam numa coluna na borda direita: editar em cima, excluir embaixo (sem tocar no texto)", () => {
    render(<ServiceCard service={service} photos={[]} side={<><button aria-label="Editar">e</button><button aria-label="Excluir">x</button></>} />)
    const card = screen.getByTestId("service-card")
    const lateral = screen.getByRole("button", { name: "Editar" }).parentElement!
    expect(lateral).toBe(screen.getByRole("button", { name: "Excluir" }).parentElement)
    expect(lateral.className).toMatch(/justify-between/) // um no topo, outro na base
    expect(card.lastElementChild).toBe(lateral) // é a última coluna do card, à direita da área de texto
    expect(screen.queryByRole("button", { name: "Reservar" })).not.toBeInTheDocument()
  })

  it("a foto fica numa célula quadrada e o rodapé pode quebrar de linha: preço e botão nunca se sobrepõem", () => {
    render(<ServiceCard service={service} photos={["a.jpg"]} action={<button>Reservar</button>} />)
    expect(document.querySelector(".aspect-square")).toBeInTheDocument()
    const rodape = screen.getByRole("button", { name: "Reservar" }).parentElement!.parentElement!
    expect(rodape.className).toMatch(/flex-wrap/)
  })
})
