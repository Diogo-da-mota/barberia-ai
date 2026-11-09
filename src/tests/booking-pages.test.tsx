/// <reference types="@testing-library/jest-dom/vitest" />

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/lib/theme"

const m = vi.hoisted(() => ({
  fetchMyBarbershops: vi.fn(), getCurrentUser: vi.fn(), getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn(),
  getPublicShop: vi.fn(), getAvailability: vi.fn(), createBooking: vi.fn(), cancelBooking: vi.fn(), rescheduleBooking: vi.fn(),
  setBookingStatus: vi.fn(), fetchMyBookings: vi.fn(), fetchShopBookings: vi.fn(), fetchBlocks: vi.fn(), createBlock: vi.fn(), deleteBlock: vi.fn(),
  fetchWorkingHours: vi.fn(), saveWorkingHours: vi.fn(), acceptInvite: vi.fn(), createInvite: vi.fn(), fetchInvites: vi.fn(), updateShopInfo: vi.fn(),
  fetchProfessionals: vi.fn(), fetchCustomerBookings: vi.fn(), fetchCustomerConsents: vi.fn(), fetchShopDetails: vi.fn(), fetchFiscal: vi.fn(),
}))

vi.mock("@/features/home/api", () => ({ fetchMyBarbershops: m.fetchMyBarbershops }))
vi.mock("@/features/auth/services/auth", async (original) => ({
  ...(await original<typeof import("@/features/auth/services/auth")>()),
  getSession: m.getSession, getCurrentUser: m.getCurrentUser, onAuthStateChange: m.onAuthStateChange, signOut: m.signOut,
}))
vi.mock("@/features/catalog/api", () => ({ fetchProfessionals: m.fetchProfessionals, fetchServices: async () => ({ status: "ok", data: [] }) }))
// dados da barbearia (aba Dados de Mais): aqui, banco sem a migration 0012 (só nome, endereço em uma linha e telefone)
vi.mock("@/features/settings/api", () => ({ fetchShopDetails: m.fetchShopDetails, fetchFiscal: m.fetchFiscal, saveShopProfile: vi.fn(), saveShopFiscal: vi.fn(), lookupCep: vi.fn() }))
vi.mock("@/features/booking/api", () => ({
  getPublicShop: m.getPublicShop, getAvailability: m.getAvailability, createBooking: m.createBooking, cancelBooking: m.cancelBooking,
  rescheduleBooking: m.rescheduleBooking, setBookingStatus: m.setBookingStatus, fetchMyBookings: m.fetchMyBookings,
  fetchShopBookings: m.fetchShopBookings, fetchBlocks: m.fetchBlocks, createBlock: m.createBlock, deleteBlock: m.deleteBlock,
  fetchWorkingHours: m.fetchWorkingHours, saveWorkingHours: m.saveWorkingHours, acceptInvite: m.acceptInvite,
  createInvite: m.createInvite, fetchInvites: m.fetchInvites, updateShopInfo: m.updateShopInfo, fetchCustomerBookings: m.fetchCustomerBookings, fetchCustomerConsents: m.fetchCustomerConsents,
}))

import { AcceptInvite } from "@/features/booking/pages/AcceptInvite"
import { Agenda } from "@/features/booking/pages/Agenda"
import { Customers } from "@/features/booking/pages/Customers"
import { WorkingHoursEditor, toIntervals } from "@/features/booking/components/WorkingHours"
import { More } from "@/features/booking/pages/More"
import { MyBookings } from "@/features/booking/pages/MyBookings"
import { ClientAccess, ClientBookings } from "@/features/booking/pages/ClientBookings"
import { PublicShop } from "@/features/booking/pages/PublicShop"

const SHOP = { id: "loja-1", nome: "Barbearia Teste", slug: "barbearia-teste", endereco: "Rua Um", status: "ativo", fuso: "America/Sao_Paulo", papel: "proprietario" }
const PUBLIC = {
  id: "loja-1", nome: "Barbearia Teste", slug: "barbearia-teste", endereco: "Rua Um, Centro", telefone: null, fuso: "America/Sao_Paulo",
  services: [{ id: "svc1", nome: "Corte", descricao: "Social", preco_centavos: 6000, duracao_min: 40 }],
  professionals: [{ id: "p1", nome: "Ana", service_ids: ["svc1"] }],
}
const SLOT = { prof_id: "p1", prof_nome: "Ana", slot_inicio: "2099-01-10T12:00:00.000Z" }
const session = { user: { id: "u1", user_metadata: {} } }

function renderAt(path: string, routePath: string, element: React.ReactElement) {
  const router = createMemoryRouter([{ path: routePath, element }, { path: "*", element: <p>outra</p> }], { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <ThemeProvider><QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider></ThemeProvider>
  )
  return router
}
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
/** Campo de hora em pop-up: abre, escolhe hora e minutos e fecha. */
const pickTime = (label: string, hhmm: string) => {
  fireEvent.click(screen.getByLabelText(label))
  const [h, m] = hhmm.split(":")
  fireEvent.click(within(screen.getByRole("listbox", { name: "Hora" })).getByRole("option", { name: h }))
  fireEvent.click(within(screen.getByRole("listbox", { name: "Minutos" })).getByRole("option", { name: m }))
  fireEvent.click(screen.getByRole("button", { name: "OK" }))
}
const booking = (over: Record<string, unknown> = {}) => ({
  id: "b1", barbershop_id: "loja-1", professional_id: "p1", customer_id: "u1", service_id: "svc1", servico_nome: "Corte", preco_centavos: 6000,
  duracao_min: 40, inicio: "2099-01-10T12:00:00.000Z", fim: "2099-01-10T12:40:00.000Z", status: "confirmado", cliente_nome: "Cliente Um",
  cliente_whatsapp: "11912345678", professionals: { nome: "Ana" }, barbershops: { nome: "Barbearia Teste", fuso: "America/Sao_Paulo", slug: "barbearia-teste" }, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  m.getSession.mockResolvedValue(session)
  m.getCurrentUser.mockResolvedValue({ id: "u1" })
  m.onAuthStateChange.mockReturnValue({ subscription: { unsubscribe: vi.fn() } })
  m.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [SHOP] })
  m.getPublicShop.mockResolvedValue(PUBLIC)
  m.getAvailability.mockResolvedValue([SLOT])
  m.createBooking.mockResolvedValue("novo")
  m.fetchMyBookings.mockResolvedValue([booking(), booking({ id: "b2", status: "cancelado", inicio: "2020-01-10T12:00:00.000Z", fim: "2020-01-10T12:40:00.000Z" })])
  m.fetchCustomerConsents.mockResolvedValue([])
  m.fetchProfessionals.mockResolvedValue({ status: "ok", data: [{ id: "p1", nome: "Ana", ativo: true, service_ids: ["svc1"] }] })
  m.fetchBlocks.mockResolvedValue([])
  m.fetchShopBookings.mockResolvedValue([])
  m.fetchInvites.mockResolvedValue([])
  for (const fn of [m.cancelBooking, m.rescheduleBooking, m.setBookingStatus, m.saveWorkingHours, m.createBlock, m.deleteBlock, m.updateShopInfo]) fn.mockResolvedValue(undefined)
})

describe("Página pública e agendamento", () => {
  const open = () => renderAt("/barbearia-teste", "/:slug", <PublicShop />)
  async function chooseSlot() {
    fireEvent.click(await screen.findByRole("button", { name: /Reservar Corte/ }))
    fireEvent.click(await screen.findByRole("button", { name: "09:00" }))
  }

  it("mostra os serviços e libera as etapas conforme a escolha", async () => {
    open()
    expect(await screen.findByRole("heading", { level: 1, name: "Barbearia Teste" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Escolha o profissional" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Reservar Corte/ })) // abre o pop-up da reserva
    expect(await screen.findByRole("button", { name: "Qualquer profissional disponível" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Ana" })).toBeInTheDocument()
    expect(m.getAvailability).toHaveBeenCalledWith("loja-1", "svc1", null, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
  })

  it("confirma a reserva com sessão e mostra o resumo", async () => {
    open()
    await chooseSlot()
    type("Nome", "Maria Souza")
    type("WhatsApp", "(11) 91234-5678")
    fireEvent.click(screen.getByLabelText(/avisos e lembretes/))
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar reserva" }))

    expect(await screen.findByRole("heading", { name: "Reserva confirmada" })).toBeInTheDocument()
    expect(m.createBooking).toHaveBeenCalledWith(expect.objectContaining({
      shopId: "loja-1", serviceId: "svc1", professionalId: null, inicio: SLOT.slot_inicio, nome: "Maria Souza", whatsapp: "11912345678", lembretes: true, marketing: false,
    }))
    expect(screen.getByRole("link", { name: "Ver minhas reservas" })).toHaveAttribute("href", "/barbearia-teste/minhas-reservas")
  })

  it("valida o contato antes de chamar o servidor", async () => {
    open()
    await chooseSlot()
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar reserva" }))

    expect(await screen.findByText("Informe seu nome.")).toBeInTheDocument()
    expect(screen.getByLabelText("WhatsApp")).toHaveAccessibleDescription("Informe o WhatsApp com DDD, como +55 11 91234-5678.")
    expect(m.createBooking).not.toHaveBeenCalled()
  })

  it("avisa quando o horário foi ocupado por outra pessoa", async () => {
    m.createBooking.mockRejectedValue({ message: "slot_taken" })
    open()
    await chooseSlot()
    type("Nome", "Maria")
    type("WhatsApp", "11912345678")
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar reserva" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Este horário acabou de ser ocupado. Escolha outro.")
    expect(screen.queryByRole("heading", { name: "Reserva confirmada" })).not.toBeInTheDocument()
  })

  it("visitante abre o login sem perder o que preencheu", async () => {
    m.getSession.mockResolvedValue(null)
    open()
    await chooseSlot()
    type("Nome", "Maria")
    type("WhatsApp", "11912345678")
    fireEvent.click(await screen.findByRole("button", { name: "Entrar para confirmar" }))

    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(m.createBooking).not.toHaveBeenCalled()
    expect(JSON.parse(sessionStorage.getItem("barberia:booking-draft")!)).toMatchObject({ slug: "barbearia-teste", serviceId: "svc1", nome: "Maria" })
  })

  it("barbearia inexistente ou com erro tem estado próprio", async () => {
    m.getPublicShop.mockResolvedValue(null)
    open()
    expect(await screen.findByText("Barbearia não encontrada")).toBeInTheDocument()
  })
})

describe("Minhas reservas", () => {
  const open = () => renderAt("/minhas-reservas", "/minhas-reservas", <MyBookings />)

  it("separa as próximas do histórico", async () => {
    open()
    const proximas = (await screen.findByRole("heading", { name: "Próximas" })).closest("section")!
    expect(within(proximas).getByText("Corte")).toBeInTheDocument()
    const historico = screen.getByRole("heading", { name: "Histórico" }).closest("section")!
    expect(within(historico).getByText("Cancelado")).toBeInTheDocument()
    expect(within(historico).queryByRole("button")).not.toBeInTheDocument()
  })

  it("cancela só depois da confirmação", async () => {
    open()
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar reserva" }))
    const confirm = await screen.findByRole("alertdialog")
    expect(m.cancelBooking).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancelar reserva" }))
    await waitFor(() => expect(m.cancelBooking).toHaveBeenCalledWith("b1"))
  })

  it("explica quando o prazo de cancelamento já passou", async () => {
    m.cancelBooking.mockRejectedValue({ message: "cancel_window" })
    open()
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar reserva" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar reserva" }))
    await waitFor(() => expect(m.cancelBooking).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })

  it("reagenda com o mesmo profissional", async () => {
    open()
    fireEvent.click(await screen.findByRole("button", { name: "Reagendar" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("button", { name: "Confirmar novo horário" })).toBeDisabled()
    fireEvent.click(await within(dialog).findByRole("button", { name: "09:00" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar novo horário" }))
    await waitFor(() => expect(m.rescheduleBooking).toHaveBeenCalledWith("b1", SLOT.slot_inicio, "p1"))
  })

  it("mostra estado vazio sem reservas", async () => {
    m.fetchMyBookings.mockResolvedValue([])
    open()
    expect(await screen.findByText("Você ainda não tem reservas")).toBeInTheDocument()
  })
})

describe("Agenda da gestão", () => {
  const today = () => booking({ id: "b9", inicio: new Date(Date.now() - 60_000).toISOString(), fim: new Date(Date.now() + 39 * 60_000).toISOString() })
  const open = () => renderAt("/dashboard/agendamentos", "/dashboard/agendamentos", <Agenda />)

  it("lista o dia com ações de concluir, faltou e cancelar", async () => {
    m.fetchShopBookings.mockResolvedValue([today()])
    open()
    const row = (await screen.findByText("Corte")).closest("li")!
    expect(within(row).getByText(/Cliente Um/)).toBeInTheDocument()
    expect(within(row).getByRole("link", { name: /WhatsApp \+55 11 91234-5678/ })).toHaveAttribute("href", "https://wa.me/5511912345678")
    fireEvent.click(within(row).getByRole("button", { name: "Concluir" }))
    await waitFor(() => expect(m.setBookingStatus).toHaveBeenCalledWith("b9", "concluido"))
    fireEvent.click(within(row).getByRole("button", { name: "Faltou" }))
    await waitFor(() => expect(m.setBookingStatus).toHaveBeenCalledWith("b9", "nao_compareceu"))
  })

  it("cancela com confirmação e navega entre os dias", async () => {
    m.fetchShopBookings.mockResolvedValue([today()])
    open()
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar reserva de Cliente Um" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar reserva" }))
    await waitFor(() => expect(m.cancelBooking).toHaveBeenCalledWith("b9"))

    fireEvent.click(screen.getByRole("button", { name: "Próximo (dia)" }))
    expect(await screen.findByText("Nenhum atendimento neste dia")).toBeInTheDocument()
  })

  it("mostra e remove bloqueios do dia", async () => {
    const start = new Date(Date.now() - 60_000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "+00")
    const end = new Date(Date.now() + 3_600_000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "+00")
    m.fetchBlocks.mockResolvedValue([{ id: "bl1", professional_id: "p1", periodo: `["${start}","${end}")`, motivo: "Médico" }])
    open()
    expect(await screen.findByText(/Bloqueado · Ana · Médico/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Remover bloqueio/ }))
    await waitFor(() => expect(m.deleteBlock).toHaveBeenCalledWith("bl1"))
  })

  it("barbeiro vê a própria agenda e só conclui ou marca falta", async () => {
    m.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [{ ...SHOP, papel: "barbeiro" }] })
    m.fetchShopBookings.mockResolvedValue([today()])
    open()
    const row = (await screen.findByText("Corte")).closest("li")!
    expect(within(row).getByRole("button", { name: "Concluir" })).toBeInTheDocument()
    expect(within(row).getByRole("button", { name: "Faltou" })).toBeInTheDocument()
    expect(within(row).queryByRole("button", { name: /Cancelar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Bloquear horário" })).not.toBeInTheDocument()
  })

  it("cliente não acessa a agenda da equipe", async () => {
    m.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [{ ...SHOP, papel: "cliente" }] })
    open()
    expect(await screen.findByText("Crie sua barbearia primeiro")).toBeInTheDocument()
    expect(m.fetchShopBookings).not.toHaveBeenCalled()
  })

  it("alterna entre dia, semana e mês", async () => {
    m.fetchShopBookings.mockResolvedValue([today()])
    open()
    await screen.findByText("Corte")
    fireEvent.click(screen.getByRole("button", { name: "Semana" }))
    expect(await screen.findAllByRole("region", { name: /\d/ })).toHaveLength(7)
    expect(screen.getByText("Corte")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Mês" }))
    const hoje = await screen.findByRole("button", { name: /, 1 item$/ })
    fireEvent.click(hoje)
    expect(await screen.findByText("Corte")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Dia" })).toHaveAttribute("aria-pressed", "true")
  })
})

describe("Banco ainda sem a migration da agenda", () => {
  const missing = { code: "PGRST205", message: "tabela ausente" }

  it("a agenda e as reservas explicam o estado em vez de mostrar erro genérico", async () => {
    m.fetchShopBookings.mockRejectedValue(missing)
    m.fetchBlocks.mockRejectedValue(missing)
    renderAt("/dashboard/agendamentos", "/dashboard/agendamentos", <Agenda />)
    expect(await screen.findByText("Agenda indisponível")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("minhas reservas e a página pública fazem o mesmo", async () => {
    m.fetchMyBookings.mockRejectedValue(missing)
    renderAt("/minhas-reservas", "/minhas-reservas", <MyBookings />)
    expect(await screen.findByText("Reservas indisponíveis")).toBeInTheDocument()
  })

  it("a página pública sem a função do banco mostra o aviso", async () => {
    m.getPublicShop.mockRejectedValue({ code: "PGRST202" })
    renderAt("/barbearia-teste", "/:slug", <PublicShop />)
    expect(await screen.findByText("Agendamento indisponível")).toBeInTheDocument()
  })
})

describe("Clientes (/dashboard/clientes)", () => {
  const row = (id: string, nome: string, status: string, dias: number) => ({ customer_id: id, cliente_nome: nome, cliente_whatsapp: "11912345678", status, preco_centavos: 6000, inicio: new Date(Date.now() + dias * 86_400_000).toISOString() })
  const open = () => renderAt("/dashboard/clientes", "/dashboard/clientes", <Customers />)

  it("lista os clientes com histórico e total gasto, e filtra pela busca", async () => {
    m.fetchCustomerBookings.mockResolvedValue([row("a", "Maria Souza", "concluido", -5), row("a", "Maria Souza", "nao_compareceu", -9), row("b", "João Lima", "confirmado", 3)])
    open()
    const maria = (await screen.findByText("Maria Souza")).closest("li")!
    expect(within(maria).getByText("Concluídas").nextElementSibling).toHaveTextContent("1")
    expect(within(maria).getByText("Faltas").nextElementSibling).toHaveTextContent("1")
    expect(maria).toHaveTextContent(/R\$\s60,00 em atendimentos/)

    type("Buscar por nome ou WhatsApp", "joão")
    expect(screen.queryByText("Maria Souza")).not.toBeInTheDocument()
    expect(screen.getByText("João Lima")).toBeInTheDocument()
    type("Buscar por nome ou WhatsApp", "zzz")
    expect(screen.getByText("Nenhum cliente encontrado para essa busca.")).toBeInTheDocument()
  })

  it("o WhatsApp tem o logotipo oficial e abre o WhatsApp Web na conversa do cliente", async () => {
    m.fetchCustomerBookings.mockResolvedValue([row("a", "Maria Souza", "concluido", -5)])
    open()
    const maria = (await screen.findByText("Maria Souza")).closest("li")!
    const link = within(maria).getByRole("link", { name: /WhatsApp Web com Maria Souza: \+55 11 91234-5678/ })
    expect(link).toHaveAttribute("href", "https://web.whatsapp.com/send?phone=5511912345678")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link.querySelector("svg")).toHaveAttribute("fill", "#25D366")
  })

  it("mostra os dois termos aceitos (reserva e consentimento vigente), as contagens e o próximo agendamento", async () => {
    const r = (over: Record<string, unknown>) => ({ ...row("a", "Maria Souza", "concluido", -5), servico_nome: "Corte", consent_lembretes: true, consent_marketing: true, criado_em: "2026-01-01T00:00:00Z", ...over })
    m.fetchCustomerBookings.mockResolvedValue([r({}), r({ status: "cancelado", inicio: new Date(Date.now() - 20 * 86_400_000).toISOString() }), r({ status: "confirmado", servico_nome: "Barba", inicio: new Date(Date.now() + 3 * 86_400_000).toISOString() })])
    m.fetchCustomerConsents.mockResolvedValue([{ profile_id: "a", marketing: false, atualizado_em: null, opt_out_em: "2026-02-01T00:00:00Z" }])
    open()
    const maria = (await screen.findByText("Maria Souza")).closest("li")!
    const termos = within(maria).getByRole("list", { name: "Termos aceitos" })
    expect(within(termos).getByText("Avisos e lembretes da reserva").parentElement).toHaveTextContent("Aceitou")
    // o consentimento vigente (saiu por PARAR) vale mais que a resposta antiga da reserva
    await waitFor(() => expect(within(termos).getByText("Novidades e promoções").parentElement).toHaveTextContent("Não aceitou"))
    expect(within(maria).getByText("Confirmadas").nextElementSibling).toHaveTextContent("2")
    expect(within(maria).getByText("Canceladas").nextElementSibling).toHaveTextContent("1")
    expect(within(maria).getByText("Próximo agendamento").parentElement).toHaveTextContent("Barba")
  })

  it("filtra por quem aceitou avisos ou novidades; o barbeiro não vê os termos dos clientes", async () => {
    const r = (id: string, nome: string, lembretes: boolean) => ({ ...row(id, nome, "confirmado", 3), consent_lembretes: lembretes, consent_marketing: false, criado_em: "2026-01-01T00:00:00Z" })
    m.fetchCustomerBookings.mockResolvedValue([r("a", "Maria Souza", true), r("b", "João Lima", false)])
    open()
    await screen.findByText("Maria Souza")
    fireEvent.click(screen.getByRole("button", { name: /Aceitam avisos \(1\)/ }))
    expect(screen.getByText("Maria Souza")).toBeInTheDocument()
    expect(screen.queryByText("João Lima")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Aceitam novidades \(0\)/ }))
    expect(screen.getByText("Nenhum cliente encontrado para essa busca.")).toBeInTheDocument()
  })

  it("mostra estado vazio, banco em preparação e erro sem detalhes", async () => {
    m.fetchCustomerBookings.mockResolvedValue([])
    open()
    expect(await screen.findByText("Nenhum cliente ainda")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Abrir página pública" })).toHaveAttribute("href", "/barbearia-teste")
  })

  it("explica a migration ausente e o erro genérico", async () => {
    m.fetchCustomerBookings.mockRejectedValueOnce({ code: "PGRST205" })
    open()
    expect(await screen.findByText("Clientes indisponíveis")).toBeInTheDocument()
  })

  it("barbeiro vê a página com texto próprio", async () => {
    m.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [{ ...SHOP, papel: "barbeiro" }] })
    m.fetchCustomerBookings.mockResolvedValue([])
    open()
    expect(await screen.findByText("Os clientes dos seus atendimentos aparecem aqui.")).toBeInTheDocument()
  })
})

describe("Horários de atendimento", () => {
  it("converte o formulário em intervalos e acusa horários inválidos", () => {
    const base = { a1: "", a2: "", b1: "", b2: "" }
    const form = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, base]))
    expect(toIntervals({ ...form, 1: { a1: "09:00", a2: "12:00", b1: "13:00", b2: "18:00" } }).intervals).toEqual([
      { dow: 1, inicio_min: 540, fim_min: 720 }, { dow: 1, inicio_min: 780, fim_min: 1080 },
    ])
    expect(toIntervals({ ...form, 3: { a1: "10:00", a2: "09:00", b1: "", b2: "" } }).error).toBe("Confira os horários de Quarta-feira.")
    expect(toIntervals({ ...form, 2: { a1: "09:00", a2: "12:00", b1: "11:00", b2: "14:00" } }).error).toBe("Confira os horários de Terça-feira.")
    expect(toIntervals({ ...form, 2: { a1: "09:00", a2: "", b1: "", b2: "" } }).error).toBe("Terça-feira: preencha o horário em que fecha.")
    expect(toIntervals({ ...form, 1: { a1: "", a2: "", b1: "", b2: "18:00" } }).error).toBe("Segunda-feira: preencha o horário em que abre.")
  })

  it("aceita abre e fecha sem horário de almoço (um único período)", () => {
    const base = { a1: "", a2: "", b1: "", b2: "" }
    const form = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, base]))
    // o caso real: só abre (08:00) e fecha (18:00), campos do almoço vazios
    expect(toIntervals({ ...form, 1: { a1: "08:00", a2: "", b1: "", b2: "18:00" } })).toEqual({
      intervals: [{ dow: 1, inicio_min: 480, fim_min: 1080 }],
    })
    // abre e fecha também podem vir nos campos "fecha pro almoço" e "abre pro almoço" (sem pausa)
    expect(toIntervals({ ...form, 1: { a1: "08:00", a2: "18:00", b1: "", b2: "" } }).intervals).toEqual([{ dow: 1, inicio_min: 480, fim_min: 1080 }])
    expect(toIntervals({ ...form, 1: { a1: "08:00", a2: "", b1: "", b2: "" } }).error).toBe("Segunda-feira: preencha o horário em que fecha.")
    // almoço incompleto: saiu para almoço sem voltar
    expect(toIntervals({ ...form, 1: { a1: "08:00", a2: "12:00", b1: "", b2: "18:00" } }).error).toBe("Segunda-feira: preencha o horário em que volta do almoço, ou apague o almoço.")
    // com almoço completo continua com dois períodos
    expect(toIntervals({ ...form, 1: { a1: "08:00", a2: "12:00", b1: "13:00", b2: "18:00" } }).intervals).toHaveLength(2)
    // fecha antes de abrir continua recusado
    expect(toIntervals({ ...form, 1: { a1: "18:00", a2: "", b1: "", b2: "08:00" } }).error).toBe("Confira os horários de Segunda-feira.")
  })

  it("carrega a jornada, liga um dia, escolhe os horários e salva", async () => {
    m.fetchWorkingHours.mockResolvedValue([{ dow: 1, inicio_min: 540, fim_min: 720 }, { dow: 1, inicio_min: 780, fim_min: 1080 }])
    renderAt("/dashboard/equipe", "/dashboard/equipe", <WorkingHoursEditor professionalId="p1" />)

    // segunda com almoço: abre 09:00, sai 12:00, volta 13:00, fecha 18:00
    expect(await screen.findByLabelText("Segunda-feira, abre")).toHaveTextContent("09:00")
    expect(screen.getByLabelText("Segunda-feira, fecha")).toHaveTextContent("18:00")
    expect(screen.getByLabelText("Segunda-feira, sai para o almoço")).toHaveTextContent("12:00")
    expect(screen.getByLabelText("Segunda-feira, volta do almoço")).toHaveTextContent("13:00")
    // terça estava de folga: liga o dia (os campos nascem VAZIOS) e o usuário escolhe os horários
    fireEvent.click(screen.getByRole("switch", { name: "Terça-feira: atende" }))
    expect(screen.getByLabelText("Terça-feira, abre")).toHaveTextContent("--:--")
    expect(screen.getByLabelText("Terça-feira, fecha")).toHaveTextContent("--:--")
    pickTime("Terça-feira, abre", "08:00")
    pickTime("Terça-feira, fecha", "12:00")
    fireEvent.click(screen.getByRole("button", { name: "Salvar horários" }))

    await waitFor(() => expect(m.saveWorkingHours).toHaveBeenCalledWith("p1", [
      { dow: 1, inicio_min: 540, fim_min: 720 }, { dow: 1, inicio_min: 780, fim_min: 1080 }, { dow: 2, inicio_min: 480, fim_min: 720 },
    ]))
  })

  it("dia sem almoço volta do banco com abre e fecha; o almoço é opcional e some ao desmarcar", async () => {
    m.fetchWorkingHours.mockResolvedValue([{ dow: 3, inicio_min: 480, fim_min: 1020 }])
    renderAt("/dashboard/equipe", "/dashboard/equipe", <WorkingHoursEditor professionalId="p1" />)
    expect(await screen.findByLabelText("Quarta-feira, abre")).toHaveTextContent("08:00")
    expect(screen.getByLabelText("Quarta-feira, fecha")).toHaveTextContent("17:00")
    expect(screen.queryByLabelText("Quarta-feira, sai para o almoço")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox", { name: "Quarta-feira: tem almoço" }))
    expect(screen.getByLabelText("Quarta-feira, sai para o almoço")).toHaveTextContent("--:--") // vazio: o usuário escolhe
    expect(screen.getByLabelText("Quarta-feira, volta do almoço")).toHaveTextContent("--:--")
    fireEvent.click(screen.getByRole("checkbox", { name: "Quarta-feira: tem almoço" }))
    expect(screen.queryByLabelText("Quarta-feira, sai para o almoço")).not.toBeInTheDocument()
  })

  it("desligar um dia vira folga e copiar a segunda preenche de terça a sexta", async () => {
    m.fetchWorkingHours.mockResolvedValue([{ dow: 1, inicio_min: 540, fim_min: 1080 }])
    renderAt("/dashboard/equipe", "/dashboard/equipe", <WorkingHoursEditor professionalId="p1" />)
    await screen.findByLabelText("Segunda-feira, abre")
    fireEvent.click(screen.getByRole("button", { name: /Copiar segunda para seg–sex/ }))
    fireEvent.click(screen.getByRole("switch", { name: "Sexta-feira: atende" })) // desliga a sexta
    fireEvent.click(screen.getByRole("button", { name: "Salvar horários" }))
    await waitFor(() => expect(m.saveWorkingHours).toHaveBeenCalledWith("p1", [1, 2, 3, 4].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 }))))
  })

  it("os horários são de 15 em 15 minutos", async () => {
    m.fetchWorkingHours.mockResolvedValue([])
    renderAt("/dashboard/equipe", "/dashboard/equipe", <WorkingHoursEditor professionalId="p1" />)
    fireEvent.click(await screen.findByRole("switch", { name: "Segunda-feira: atende" }))
    fireEvent.click(screen.getByLabelText("Segunda-feira, abre"))
    const minutos = within(screen.getByRole("listbox", { name: "Minutos" })).getAllByRole("option").map((o) => o.textContent)
    expect(minutos).toEqual(["00", "15", "30", "45"])
  })

  it("dia ligado ou almoço marcado sem horários não salva e explica o que falta", async () => {
    m.fetchWorkingHours.mockResolvedValue([])
    renderAt("/dashboard/equipe", "/dashboard/equipe", <WorkingHoursEditor professionalId="p1" />)
    fireEvent.click(await screen.findByRole("switch", { name: "Quinta-feira: atende" }))
    fireEvent.click(screen.getByRole("button", { name: "Salvar horários" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Quinta-feira: escolha o horário em que abre e em que fecha")
    pickTime("Quinta-feira, abre", "09:00")
    pickTime("Quinta-feira, fecha", "18:00")
    fireEvent.click(screen.getByRole("checkbox", { name: "Quinta-feira: tem almoço" }))
    fireEvent.click(screen.getByRole("button", { name: "Salvar horários" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Quinta-feira: escolha a saída e a volta do almoço")
    expect(m.saveWorkingHours).not.toHaveBeenCalled()
  })

  it("não salva com horário inválido", async () => {
    m.fetchWorkingHours.mockResolvedValue([])
    renderAt("/dashboard/equipe", "/dashboard/equipe", <WorkingHoursEditor professionalId="p1" />)
    await screen.findByRole("switch", { name: "Quarta-feira: atende" })
    fireEvent.click(screen.getByRole("switch", { name: "Quarta-feira: atende" }))
    pickTime("Quarta-feira, abre", "10:00")
    pickTime("Quarta-feira, fecha", "09:00")
    fireEvent.click(screen.getByRole("button", { name: "Salvar horários" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Confira os horários de Quarta-feira.")
    expect(m.saveWorkingHours).not.toHaveBeenCalled()
  })
})

describe("Mais", () => {
  const open = () => renderAt("/dashboard/mais", "/dashboard/mais", <More />)
  beforeEach(() => {
    m.fetchShopDetails.mockResolvedValue({ supported: false, nome: "Barbearia Teste", nome_exibicao: null, descricao: null, telefone: null, whatsapp: null, email_comercial: null, endereco: "Rua Um", cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null, cor_destaque: null, fuso: "America/Sao_Paulo" })
    m.fetchFiscal.mockResolvedValue({ supported: false, data: null })
  })

  it("salva os dados da barbearia e valida o nome", async () => {
    open()
    await screen.findByLabelText(/Nome da barbearia/)
    type(/Nome da barbearia/, " ")
    fireEvent.click(await screen.findByRole("button", { name: "Salvar alterações" }))
    expect(await screen.findByText("Informe o nome da barbearia.")).toBeInTheDocument()
    type(/Nome da barbearia/, "Novo Nome")
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }))
    await waitFor(() => expect(m.updateShopInfo).toHaveBeenCalledWith("loja-1", { nome: "Novo Nome", endereco: "Rua Um" }))
  })

  it("barbeiro vê só os atalhos", async () => {
    m.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [{ ...SHOP, papel: "barbeiro" }] })
    open()
    await screen.findAllByRole("link", { name: /Minhas reservas/ })
    expect(screen.queryByRole("button", { name: "Gerar link do convite" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Horários de atendimento/ })).not.toBeInTheDocument()
  })
})

describe("Aceitar convite", () => {
  it("pede o link completo", async () => {
    renderAt("/convite", "/convite", <AcceptInvite />)
    expect(await screen.findByText("Link de convite incompleto")).toBeInTheDocument()
  })

  it("aceita o convite com sessão e mostra o motivo se for recusado", async () => {
    m.acceptInvite.mockRejectedValueOnce({ message: "invalid_invite" })
    renderAt("/convite?token=tok", "/convite", <AcceptInvite />)
    fireEvent.click(await screen.findByRole("button", { name: "Aceitar convite" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Convite inválido, expirado ou enviado para outro email.")

    m.acceptInvite.mockResolvedValue("loja-1")
    fireEvent.click(screen.getByRole("button", { name: "Aceitar convite" }))
    await waitFor(() => expect(m.acceptInvite).toHaveBeenLastCalledWith("tok"))
  })
})


describe("Acesso do cliente (porta separada da gestão)", () => {
  const openClient = () => renderAt("/barbearia-teste/minhas-reservas", "/:slug/minhas-reservas", <ClientBookings />)

  it("sem login mostra o acesso da barbearia (não a landing do sistema) e abre entrar/criar conta", async () => {
    m.getSession.mockResolvedValue(null)
    openClient()
    expect(await screen.findByRole("heading", { name: "Acesso — Barbearia Teste" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Barbearia Teste, ir para o início/ })).toHaveAttribute("href", "/barbearia-teste")
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }))
    expect(await screen.findByRole("heading", { name: /conta/i })).toBeInTheDocument()
  })

  it("com login lista só as reservas daquela barbearia, com a marca dela", async () => {
    m.fetchMyBookings.mockResolvedValue([booking(), booking({ id: "b9", servico_nome: "Barba de outra loja", barbershops: { nome: "Outra", fuso: "America/Sao_Paulo", slug: "outra" } })])
    openClient()
    expect(await screen.findByRole("heading", { level: 1, name: "Suas reservas" })).toBeInTheDocument()
    expect(await screen.findByText("Corte")).toBeInTheDocument()
    expect(screen.queryByText("Barba de outra loja")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Nova reserva" })).toHaveAttribute("href", "/barbearia-teste")
  })

  it("separa Próximas e Histórico com o resumo real, a foto do serviço e ações só onde a reserva permite", async () => {
    m.getPublicShop.mockResolvedValue({ ...PUBLIC, cor_destaque: "verde", services: [{ ...PUBLIC.services[0], imagem_path: "loja-1/corte.png" }] })
    m.fetchMyBookings.mockResolvedValue([
      booking({ id: "b1" }), // próxima, confirmada
      booking({ id: "b2", status: "cancelado", inicio: "2020-01-10T12:00:00.000Z", fim: "2020-01-10T12:40:00.000Z" }),
      booking({ id: "b3", status: "concluido", servico_nome: "Barba", inicio: "2020-02-10T12:00:00.000Z", fim: "2020-02-10T12:30:00.000Z" }),
      booking({ id: "b9", servico_nome: "De outra loja", barbershops: { nome: "Outra", fuso: "America/Sao_Paulo", slug: "outra" } }),
    ])
    openClient()
    const proximas = (await screen.findByRole("heading", { name: "Próximas" })).closest("section")!
    const historico = screen.getByRole("heading", { name: "Histórico" }).closest("section")!
    // resumo: contagens reais do cliente nesta barbearia (a de outra barbearia não entra)
    const resumo = screen.getByRole("group", { name: "Resumo das reservas" })
    expect(within(resumo).getByText("Próximas reservas").previousSibling).toHaveTextContent("1")
    expect(within(resumo).getByText("Reservas no histórico").previousSibling).toHaveTextContent("2")
    // próxima: status, dados e as duas ações
    expect(within(proximas).getByText("Confirmado")).toBeInTheDocument()
    expect(within(proximas).getByText(/Ana/)).toBeInTheDocument()
    expect(within(proximas).getByRole("button", { name: /Reagendar/ })).toBeInTheDocument()
    expect(within(proximas).getByRole("button", { name: /Cancelar reserva/ })).toBeInTheDocument()
    expect(proximas.querySelector("img")?.getAttribute("src")).toMatch(/loja-1\/corte\.png/) // a foto cadastrada no serviço, não uma imagem inventada
    // histórico: estados reais e nenhuma ação
    expect(within(historico).getByText("Cancelado")).toBeInTheDocument()
    expect(within(historico).getByText("Concluído")).toBeInTheDocument()
    expect(within(historico).queryByRole("button")).not.toBeInTheDocument()
    expect(screen.queryByText("De outra loja")).not.toBeInTheDocument()
  })

  it("o cabeçalho leva às seções reais da página pública, sem páginas inventadas", async () => {
    m.fetchMyBookings.mockResolvedValue([booking()])
    openClient()
    await screen.findByRole("heading", { level: 1, name: "Suas reservas" })
    const nav = screen.getByRole("navigation", { name: "Seções da barbearia" })
    expect(within(nav).getByRole("link", { name: "Serviços" })).toHaveAttribute("href", "/barbearia-teste/servicos")
    expect(within(nav).getByRole("link", { name: "Profissionais" })).toHaveAttribute("href", "/barbearia-teste/profissionais")
    expect(within(nav).getByRole("link", { name: "Nossa barbearia" })).toHaveAttribute("href", "/barbearia-teste")
    expect(within(nav).getByRole("link", { name: "Contato" })).toHaveAttribute("href", "/barbearia-teste/contato")
    expect(screen.getAllByRole("link", { name: "Minhas reservas" })[0]).toHaveAttribute("href", "/barbearia-teste/minhas-reservas")
  })

  it("cancelar pede confirmação e só então cancela (a mesma lógica do painel)", async () => {
    m.fetchMyBookings.mockResolvedValue([booking()])
    m.cancelBooking.mockResolvedValue(undefined)
    openClient()
    fireEvent.click(await screen.findByRole("button", { name: /Cancelar reserva/ }))
    expect(m.cancelBooking).not.toHaveBeenCalled()
    fireEvent.click(await within(await screen.findByRole("alertdialog")).findByRole("button", { name: "Cancelar reserva" }))
    await waitFor(() => expect(m.cancelBooking).toHaveBeenCalledWith("b1"))
  })

  it("sem reservas mostra o estado vazio com o caminho para agendar", async () => {
    m.fetchMyBookings.mockResolvedValue([])
    openClient()
    expect(await screen.findByText("Você ainda não tem reservas")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Agendar um horário" })).toHaveAttribute("href", "/barbearia-teste")
  })

  it("o cabeçalho público não tem o botão Painel para ninguém: nem cliente, nem equipe", async () => {
    m.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [{ ...SHOP, papel: "proprietario" }] })
    openClient()
    await screen.findByRole("heading", { level: 1, name: "Suas reservas" })
    expect(screen.queryByRole("link", { name: "Painel" })).not.toBeInTheDocument()
    expect(document.querySelector('a[href="/dashboard"]')).toBeNull()
    expect(screen.getAllByRole("link", { name: "Minhas reservas" })[0]).toBeInTheDocument() // o resto da navegação continua
    expect(screen.getByRole("button", { name: "Conta" })).toBeInTheDocument()
  })

  it("o cliente final (só com vínculo de cliente) também não vê o link Painel", async () => {
    m.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [{ ...SHOP, papel: "cliente" }] })
    openClient()
    await screen.findByRole("heading", { level: 1, name: "Suas reservas" })
    expect(screen.queryByRole("link", { name: "Painel" })).not.toBeInTheDocument()
  })

  it("a equipe também não vê o botão Painel no cabeçalho da página pública da barbearia", async () => {
    renderAt("/barbearia-teste", "/:slug", <PublicShop />)
    await screen.findByRole("heading", { level: 1, name: "Barbearia Teste" })
    expect(screen.queryByRole("link", { name: "Painel" })).not.toBeInTheDocument()
  })

  it("a página da barbearia mostra o botão Acesso para quem não entrou", async () => {
    m.getSession.mockResolvedValue(null)
    renderAt("/barbearia-teste", "/:slug", <PublicShop />)
    expect(await screen.findByRole("button", { name: "Acesso" })).toBeInTheDocument()
  })

  it("/acesso é a porta neutra do cliente", async () => {
    m.getSession.mockResolvedValue(null)
    renderAt("/acesso", "/acesso", <ClientAccess />)
    expect(await screen.findByRole("heading", { name: "Acesso do cliente" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument()
  })
})


describe("Pop-up de detalhes do serviço (página pública)", () => {
  const open = () => renderAt("/barbearia-teste", "/:slug", <PublicShop />)

  it("clicar no card abre o pop-up com nome, preço, descrição, duração e quem atende", async () => {
    open()
    fireEvent.click(await screen.findByTestId("service-card"))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: "Corte" })).toBeInTheDocument()
    expect(within(dialog).getByText(/60,00/)).toBeInTheDocument()
    expect(within(dialog).getByText("Social")).toBeInTheDocument()
    expect(within(dialog).getByText(/40 min/)).toBeInTheDocument()
    expect(within(dialog).getByRole("region", { name: "Quem atende" })).toHaveTextContent("Ana")
  })

  it("o título do card é um botão para o teclado e abre o mesmo pop-up", async () => {
    open()
    fireEvent.click(await screen.findByRole("button", { name: "Ver detalhes de Corte" }))
    expect(await screen.findByRole("dialog")).toHaveTextContent("Social")
  })

  it("o botão Reservar do card continua indo direto para a reserva, sem abrir os detalhes", async () => {
    open()
    fireEvent.click(await screen.findByRole("button", { name: "Reservar Corte" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: "Reservar Corte" })).toBeInTheDocument()
  })

  it("Reservar dentro dos detalhes fecha o pop-up e abre a reserva", async () => {
    open()
    fireEvent.click(await screen.findByTestId("service-card"))
    const details = await screen.findByRole("dialog")
    fireEvent.click(within(details).getByRole("button", { name: /^Reservar Corte/ }))
    expect(await screen.findByRole("heading", { name: "Reservar Corte" })).toBeInTheDocument()
    expect(screen.queryByText("Quem atende")).not.toBeInTheDocument()
  })

  it("sem profissional habilitado o botão Reservar do pop-up fica desativado", async () => {
    m.getPublicShop.mockResolvedValue({ ...PUBLIC, professionals: [] })
    open()
    fireEvent.click(await screen.findByTestId("service-card"))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("button", { name: /^Reservar Corte/ })).toBeDisabled()
    expect(dialog).toHaveTextContent("Nenhum profissional atende")
  })
})


describe("faixa fotográfica nas páginas da equipe", () => {
  it("a agenda da equipe tem a faixa 'agenda' atrás do título Agendamentos", async () => {
    renderAt("/dashboard/agendamentos", "/dashboard/agendamentos", <Agenda />)
    const titulo = await screen.findByRole("heading", { name: "Agendamentos" })
    expect(titulo.closest('[data-banner="agenda"]')).not.toBeNull()
  })
})
