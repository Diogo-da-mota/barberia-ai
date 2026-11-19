// @vitest-environment node
//
// Nome do cliente nas mensagens do WhatsApp da barbearia: quem reserva digita o nome e o número de destino, então o nome
// nunca pode levar link, domínio, e-mail, número ou quebra de linha para o texto enviado em nome da barbearia.
import { describe, expect, it } from "vitest"
import { DEFAULT_TEMPLATES, buildMessage, messageVariables, nomeCliente, renderTemplate } from "../functions/_shared/messages"

const GOLPE = "https://golpe.example/estorno\nSeu PIX de R$ 250,00 foi estornado. Confirme em www.golpe.example/pix ou golpe.com.br, suporte@golpe.example ou 0800 123 4567"
const RESERVA = { servico: "Corte", profissional: "Ana", inicio: "2026-11-18T12:00:00Z", fuso: "America/Sao_Paulo", barbearia: "Barbearia Exemplo" }
const CONFIRMACAO_COM_CLIENTE = "✅ Olá, {cliente}! Seu agendamento está confirmado.\n📅 {data} às {hora} - {barbearia}"
const proibido = (texto: string) => {
  expect(texto).not.toMatch(/:\/\/|www\.|golpe|\.com|\.example|@/i)
  expect(texto).not.toMatch(/250|0800|123|4567/)
}

describe("nome do cliente nas mensagens do WhatsApp", () => {
  it("nomes reais continuam iguais (acentos, apóstrofo, hífen, vários sobrenomes)", () => {
    for (const nome of ["Maria", "João da Silva", "Ana-Paula D'Ávila", "José Antônio dos Santos Oliveira", "Ñandú Çağrı"]) expect(nomeCliente(nome)).toBe(nome)
    expect(nomeCliente("  Maria   da  Silva ")).toBe("Maria da Silva")
    expect(messageVariables({ ...RESERVA, cliente: "Maria José da Silva" })).toMatchObject({ nome: "Maria", cliente: "Maria José da Silva" })
  })

  it("link, domínio, e-mail, número e quebra de linha no nome não chegam ao texto padrão ({nome})", () => {
    const texto = renderTemplate(DEFAULT_TEMPLATES.confirmacao, messageVariables({ ...RESERVA, cliente: GOLPE }))
    proibido(texto)
    expect(texto.split("\n")[0]).toBe("✅ Olá, Seu! Seu agendamento está confirmado.")
    expect(texto.split("\n")).toHaveLength(DEFAULT_TEMPLATES.confirmacao.split("\n").length)
  })

  it("com {cliente} (nome inteiro) também não entra link, número nem linha extra; o tamanho é limitado", () => {
    const texto = renderTemplate(CONFIRMACAO_COM_CLIENTE, messageVariables({ ...RESERVA, cliente: GOLPE }))
    proibido(texto)
    expect(texto.split("\n")).toHaveLength(2)
    expect(nomeCliente(GOLPE).length).toBeLessThanOrEqual(60)
    expect(nomeCliente("A".repeat(200))).toHaveLength(60)
  })

  it("nome que é só link vira o texto neutro; o caminho genérico (buildMessage) aplica a mesma regra", () => {
    expect(messageVariables({ ...RESERVA, cliente: "https://golpe.example/x" })).toMatchObject({ nome: "cliente", cliente: "cliente" })
    const generico = buildMessage("reserva_confirmada", { ...RESERVA, cliente: "golpe.com/pix\nJoão" })!
    expect(generico.startsWith("Olá, João! Sua reserva em Barbearia Exemplo está confirmada.")).toBe(true)
    proibido(generico)
    expect(buildMessage("reserva_confirmada", { ...RESERVA, cliente: "http://x.y" })!.startsWith("Olá! Sua reserva")).toBe(true)
  })
})
