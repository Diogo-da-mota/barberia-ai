/// <reference types="@testing-library/jest-dom/vitest" />
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  setBookingStatus: vi.fn(), cancelBooking: vi.fn(), rescheduleBooking: vi.fn(), getAvailability: vi.fn(),
  fetchPayments: vi.fn(), registerPayment: vi.fn(), confirmPayment: vi.fn(), discardPayment: vi.fn(),
}))
vi.mock("@/features/booking/api", () => ({
  setBookingStatus: m.setBookingStatus, cancelBooking: m.cancelBooking, rescheduleBooking: m.rescheduleBooking, getAvailability: m.getAvailability,
}))
vi.mock("@/features/finance/api", () => ({ fetchPayments: m.fetchPayments, registerPayment: m.registerPayment, confirmPayment: m.confirmPayment, discardPayment: m.discardPayment }))
vi.mock("@/features/site/api", () => ({ publicMediaUrl: () => null }))

import { MessageBookingDialog } from "./MessageBookingDialog"
import type { OutboxBooking, OutboxRow } from "../api"

const booking = (over: Partial<OutboxBooking> = {}): OutboxBooking => ({
  id: "b1", barbershop_id: "loja-1", service_id: "s1", professional_id: "p1", servico_nome: "Corte", cliente_nome: "Maria Souza", cliente_whatsapp: "11912345678",
  preco_centavos: 6000, inicio: "2099-01-10T12:00:00.000Z", fim: "2099-01-10T12:40:00.000Z", status: "confirmado", professionals: { nome: "Ana", avatar_path: null }, ...over,
})
const message = (b: OutboxBooking): OutboxRow => ({
  id: "o1", tipo: "reserva_criada", canal: "whatsapp", destino: "11912345678", status: "bloqueado", tentativas: 0, max_tentativas: 5,
  ultimo_erro: "canal_nao_configurado", criado_em: "2099-01-01T12:00:00.000Z", bookings: b,
})

function open(b: OutboxBooking) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = vi.fn()
  render(<QueryClientProvider client={client}><MessageBookingDialog message={message(b)} shopId="loja-1" tz="America/Sao_Paulo" onClose={onClose} /></QueryClientProvider>)
  return { onClose }
}
const botao = (nome: string) => screen.queryByRole("button", { name: nome })

beforeEach(() => {
  vi.clearAllMocks()
  m.fetchPayments.mockResolvedValue({ payments: [], refunds: [] })
  m.getAvailability.mockResolvedValue([{ prof_id: "p1", prof_nome: "Ana", slot_inicio: "2099-01-12T13:00:00.000Z" }])
  for (const f of [m.setBookingStatus, m.cancelBooking, m.rescheduleBooking, m.registerPayment, m.confirmPayment, m.discardPayment]) f.mockResolvedValue(undefined)
})

describe("pop-up da reserva (mensagens)", () => {
  it("mostra os dados da reserva e o que falta receber; o caixa só conta o que foi pago", async () => {
    open(booking())
    expect(await screen.findByRole("heading", { name: "Maria Souza" })).toBeInTheDocument()
    expect(screen.getByText("+55 11 91234-5678")).toBeInTheDocument()
    expect(screen.getByText("Ana")).toBeInTheDocument()
    expect(await screen.findByText(/A receber/)).toHaveTextContent("60,00")
    expect(screen.getByText(/O valor só entra no caixa depois que o pagamento é registrado/)).toBeInTheDocument()
  })

  it("confirmada: Reagendar, Pagamento e Cancelar (sem Aceitar); pendente: Aceitar, Reagendar e Cancelar (sem Pagamento)", async () => {
    open(booking({ status: "confirmado" }))
    await screen.findByRole("heading", { name: "Maria Souza" })
    expect(botao("Aceitar")).toBeNull()
    for (const nome of ["Reagendar", "Pagamento", "Cancelar"]) expect(botao(nome)).toBeInTheDocument()
  })

  it("pendente não recebe pagamento; Aceitar confirma a reserva", async () => {
    const { onClose } = open(booking({ status: "pendente" }))
    await screen.findByRole("heading", { name: "Maria Souza" })
    expect(botao("Pagamento")).toBeNull()
    fireEvent.click(botao("Aceitar")!)
    await waitFor(() => expect(m.setBookingStatus).toHaveBeenCalledWith("b1", "confirmado"))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it("reserva cancelada ou falta não tem ação nem valor a receber", async () => {
    open(booking({ status: "cancelado" }))
    await screen.findByRole("heading", { name: "Maria Souza" })
    await waitFor(() => expect(screen.queryByText(/A receber/)).not.toBeInTheDocument())
    for (const nome of ["Aceitar", "Reagendar", "Pagamento", "Cancelar"]) expect(botao(nome)).toBeNull()
  })

  it("Pagamento abre o formulário com o valor que falta e registra em centavos com chave de idempotência", async () => {
    open(booking())
    await screen.findByText(/A receber/)
    fireEvent.click(botao("Pagamento")!)
    const form = await screen.findByRole("form", { name: "Registrar pagamento" })
    expect(within(form).getByLabelText("Valor (R$)")).toHaveValue("60,00")
    fireEvent.click(within(form).getByRole("combobox", { name: "Forma de pagamento" }))
    fireEvent.click(await screen.findByRole("option", { name: "Dinheiro" }))
    fireEvent.click(within(form).getByRole("button", { name: "Registrar pagamento" }))
    await waitFor(() => expect(m.registerPayment).toHaveBeenCalledWith(expect.objectContaining({ bookingId: "b1", valor: 6000, forma: "dinheiro", parcelas: 1, key: expect.stringMatching(/.{10,}/) })))
  })

  it("a forma de pagamento é uma lista com ícones que mostra PIX, Dinheiro, Débito e Crédito", async () => {
    open(booking())
    await screen.findByText(/A receber/)
    fireEvent.click(botao("Pagamento")!)
    const form = await screen.findByRole("form", { name: "Registrar pagamento" })
    fireEvent.click(within(form).getByRole("combobox", { name: "Forma de pagamento" }))
    const opcoes = await screen.findAllByRole("option")
    expect(opcoes.map((o) => o.textContent)).toEqual(["PIX", "Dinheiro", "Débito", "Crédito"])
    for (const o of opcoes) expect(o.querySelector("svg")).not.toBeNull() // cada forma tem o seu ícone
  })

  it("pagamento declarado fica 'A confirmar' (não soma no caixa) e só some do a receber depois de confirmado", async () => {
    m.fetchPayments.mockResolvedValue({ payments: [{ id: "pay9", booking_id: "b1", valor_centavos: 6000, forma: "pix", parcelas: 1, criado_em: "2099-01-01T00:00:00Z", confirmado_em: null }], refunds: [] })
    open(booking())
    expect(await screen.findByText(/A confirmar/)).toHaveTextContent("60,00")
    expect(screen.getByText(/A receber/)).toHaveTextContent("60,00") // ainda falta receber: nada confirmado
    expect(screen.queryByText(/^Pago/)).not.toBeInTheDocument()
    fireEvent.click(botao("Pagamento")!)
    const lista = await screen.findByRole("list", { name: "Pagamentos desta reserva" })
    expect(lista).toHaveTextContent("A confirmar")
    fireEvent.click(within(lista).getByRole("button", { name: "Confirmar pagamento" }))
    await waitFor(() => expect(m.confirmPayment).toHaveBeenCalledWith("pay9"))
  })

  it("pagamento a confirmar pode ser descartado; ele trava o cancelamento até lá", async () => {
    m.fetchPayments.mockResolvedValue({ payments: [{ id: "pay9", booking_id: "b1", valor_centavos: 2000, forma: "dinheiro", parcelas: 1, criado_em: "2099-01-01T00:00:00Z", confirmado_em: null }], refunds: [] })
    open(booking())
    await screen.findByText(/A confirmar/)
    fireEvent.click(botao("Cancelar")!)
    const aviso = await screen.findByRole("region", { name: "Cancelar reserva" })
    expect(aviso).toHaveTextContent("Descarte os pagamentos a confirmar")
    expect(within(aviso).getByRole("button", { name: "Confirmar cancelamento" })).toBeDisabled()
    fireEvent.click(botao("Pagamento")!)
    fireEvent.click(within(await screen.findByRole("list", { name: "Pagamentos desta reserva" })).getByRole("button", { name: "Descartar" }))
    await waitFor(() => expect(m.discardPayment).toHaveBeenCalledWith("pay9"))
  })

  it("não aceita pagamento acima do que falta", async () => {
    m.fetchPayments.mockResolvedValue({ payments: [{ id: "pay1", booking_id: "b1", valor_centavos: 2000, forma: "pix", parcelas: 1, criado_em: "2099-01-01T00:00:00Z" }], refunds: [] })
    open(booking())
    expect(await screen.findByText(/Pago/)).toHaveTextContent("20,00")
    fireEvent.click(botao("Pagamento")!)
    const form = await screen.findByRole("form", { name: "Registrar pagamento" })
    expect(within(form).getByLabelText("Valor (R$)")).toHaveValue("40,00") // o que falta
    fireEvent.change(within(form).getByLabelText("Valor (R$)"), { target: { value: "50,00" } })
    fireEvent.click(within(form).getByRole("button", { name: "Registrar pagamento" }))
    expect(await within(form).findByRole("alert")).toHaveTextContent("não pode passar")
    expect(m.registerPayment).not.toHaveBeenCalled()
  })

  it("quitada: sem botão Pagamento, e cancelar exige estorno antes", async () => {
    m.fetchPayments.mockResolvedValue({ payments: [{ id: "pay1", booking_id: "b1", valor_centavos: 6000, forma: "pix", parcelas: 1, criado_em: "2099-01-01T00:00:00Z" }], refunds: [] })
    open(booking())
    expect(await screen.findByText(/^Pago/)).toBeInTheDocument()
    expect(botao("Pagamento")).toBeNull()
    fireEvent.click(botao("Cancelar")!)
    const aviso = await screen.findByRole("region", { name: "Cancelar reserva" })
    expect(aviso).toHaveTextContent("Estorne o pagamento")
    expect(within(aviso).getByRole("button", { name: "Confirmar cancelamento" })).toBeDisabled()
    expect(m.cancelBooking).not.toHaveBeenCalled()
  })

  it("Cancelar pede confirmação e só então cancela", async () => {
    const { onClose } = open(booking())
    await screen.findByText(/A receber/)
    fireEvent.click(botao("Cancelar")!)
    expect(m.cancelBooking).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar cancelamento" }))
    await waitFor(() => expect(m.cancelBooking).toHaveBeenCalledWith("b1"))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it("Reagendar mostra calendário e horários livres e confirma o novo horário com o mesmo profissional", async () => {
    open(booking())
    await screen.findByText(/A receber/)
    fireEvent.click(botao("Reagendar")!)
    const secao = await screen.findByRole("region", { name: "Reagendar" })
    expect(within(secao).getByRole("button", { name: "Escolha um horário" })).toBeDisabled()
    // o calendário usa o dia de hoje; o mock devolve um horário livre
    fireEvent.click(await within(secao).findByRole("button", { name: /^\d{2}:\d{2}$/ }))
    fireEvent.click(within(secao).getByRole("button", { name: /^Confirmar / }))
    await waitFor(() => expect(m.rescheduleBooking).toHaveBeenCalledWith("b1", "2099-01-12T13:00:00.000Z", "p1"))
  })
})
