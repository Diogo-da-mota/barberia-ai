/// <reference types="@testing-library/jest-dom/vitest" />

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/lib/theme"

const mocks = vi.hoisted(() => ({
  fetchMyBarbershops: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  fetchServices: vi.fn(),
  fetchServiceSales: vi.fn(),
  saveService: vi.fn(),
  deleteService: vi.fn(),
  fetchProfessionals: vi.fn(),
  saveProfessional: vi.fn(),
  deleteProfessional: vi.fn(),
  createBarbershop: vi.fn(),
  fetchBarbers: vi.fn(),
  fetchPlanUsage: vi.fn(),
  fetchTeamOrigins: vi.fn(),
  createInvite: vi.fn(),
  fetchInvites: vi.fn(),
  renewInvite: vi.fn(),
}))

vi.mock("@/features/home/api", () => ({ fetchMyBarbershops: mocks.fetchMyBarbershops }))
vi.mock("@/features/auth/services/auth", () => ({
  getSession: mocks.getSession,
  onAuthStateChange: mocks.onAuthStateChange,
  signOut: mocks.signOut,
}))
vi.mock("@/features/catalog/api", () => ({
  fetchServices: mocks.fetchServices,
  fetchServiceSales: mocks.fetchServiceSales,
  saveService: mocks.saveService,
  deleteService: mocks.deleteService,
  fetchProfessionals: mocks.fetchProfessionals,
  saveProfessional: mocks.saveProfessional,
  fetchTeamOrigins: mocks.fetchTeamOrigins,
  deleteProfessional: mocks.deleteProfessional,
  fetchBarbers: mocks.fetchBarbers,
  // fotos (galeria do serviço e perfil): o envio real é testado no banco e no navegador
  fetchProfessionalContacts: vi.fn().mockResolvedValue({}),
  saveProfessionalContact: vi.fn().mockResolvedValue(undefined),
  addServicePhoto: vi.fn(),
  removeServicePhoto: vi.fn(),
  uploadProfessionalAvatar: vi.fn(),
  removeProfessionalAvatar: vi.fn(),
}))
vi.mock("@/features/booking/api", async (original) => ({ ...(await original<typeof import("@/features/booking/api")>()), createInvite: mocks.createInvite, fetchInvites: mocks.fetchInvites, renewInvite: mocks.renewInvite }))
vi.mock("@/features/barbershops/api", () => ({ createBarbershop: mocks.createBarbershop }))
vi.mock("@/features/plans/api", () => ({ fetchPlanUsage: mocks.fetchPlanUsage }))

import { CreateBarbershop } from "@/features/barbershops/pages/CreateBarbershop"
import { saveProfessionalContact, uploadProfessionalAvatar } from "@/features/catalog/api"
import { toast } from "@/ui/sonner"
import { Services } from "@/features/catalog/pages/Services"
import { Team } from "@/features/catalog/pages/Team"

const SHOP = { id: "loja-1", nome: "Barbearia Teste", slug: "barbearia-teste", endereco: null, status: "ativo", papel: "proprietario" }
const CORTE = { id: "s1", nome: "Corte", descricao: "Social", preco_centavos: 6000, duracao_min: 40, ativo: true }
const BARBA = { id: "s2", nome: "Barba", descricao: null, preco_centavos: 4050, duracao_min: 90, ativo: false }

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/servicos", element: <Services /> },
      { path: "/equipe", element: <Team /> },
      { path: "/barbearias/nova", element: <CreateBarbershop /> },
      { path: "/dashboard", element: <p>painel</p> },
    ],
    { initialEntries: [path] }
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  )
  return router
}

const withShop = (papel = "proprietario", status = "ativo") =>
  mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [{ ...SHOP, papel, status }] })
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.getSession.mockResolvedValue({ user: { id: "user-1", user_metadata: {} } })
  mocks.onAuthStateChange.mockReturnValue({ subscription: { unsubscribe: vi.fn() } })
  mocks.fetchServices.mockResolvedValue({ status: "ok", data: [CORTE, BARBA] })
  mocks.fetchProfessionals.mockResolvedValue({ status: "ok", data: [{ id: "p1", nome: "João", ativo: true, service_ids: ["s1"] }] })
  mocks.fetchServiceSales.mockResolvedValue({ sales: [], payments: [], refunds: [] })
  mocks.saveService.mockResolvedValue(undefined)
  mocks.deleteService.mockResolvedValue(undefined)
  mocks.saveProfessional.mockResolvedValue(undefined)
  mocks.createBarbershop.mockResolvedValue("nova-id")
  mocks.fetchBarbers.mockResolvedValue([])
  mocks.fetchPlanUsage.mockResolvedValue(null)
  mocks.fetchTeamOrigins.mockResolvedValue({})
  mocks.fetchInvites.mockResolvedValue([])
  withShop()
})

describe("Serviços: indicadores, filtro e selo (dados reais)", () => {
  const venda = (id: string, service_id: string) => ({ id, service_id, preco_centavos: 6000 })
  const pago = (id: string, booking_id: string, valor: number) => ({ id, booking_id, valor_centavos: valor, confirmado_em: "2026-01-01" })

  it("mostra serviços ativos e 'Sem dados suficientes' quando não há vendas pagas; sem selo", async () => {
    renderAt("/servicos")
    const stats = await screen.findByRole("region", { name: "Indicadores de serviços" })
    expect(within(stats).getByText("Serviços ativos").nextElementSibling).toHaveTextContent("1")
    expect(within(stats).getByText("de 2 cadastrados")).toBeInTheDocument()
    expect(await within(stats).findByText("Sem dados suficientes")).toBeInTheDocument()
    expect(screen.queryByText("Mais vendido")).not.toBeInTheDocument()
  })

  it("calcula o ticket médio real, mostra o selo no mais vendido e filtra por 'Mais vendidos'", async () => {
    mocks.fetchServiceSales.mockResolvedValue({
      sales: [venda("1", "s1"), venda("2", "s1"), venda("3", "s2")],
      payments: [pago("p1", "1", 5000), pago("p2", "2", 6000), pago("p3", "3", 7000)], refunds: [],
    })
    renderAt("/servicos")
    const stats = await screen.findByRole("region", { name: "Indicadores de serviços" })
    await waitFor(() => expect(within(stats).getByText("Ticket médio").nextElementSibling).toHaveTextContent(/R\$\s60,00/))
    expect(within(stats).getByText(/3 atendimentos concluídos/)).toBeInTheDocument()
    // selo só no serviço com mais vendas
    const corte = screen.getByText("Corte").closest("li")!
    expect(within(corte).getByText("Mais vendido")).toBeInTheDocument()
    expect(within(screen.getByText("Barba").closest("li")!).queryByText("Mais vendido")).not.toBeInTheDocument()
    // filtro: um por vez, com contagem; "Mais vendidos" ordena por vendas
    expect(screen.getByRole("button", { name: "Todos (2)" })).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(screen.getByRole("button", { name: "Mais vendidos (2)" }))
    expect(screen.getByRole("button", { name: "Todos (2)" })).toHaveAttribute("aria-pressed", "false")
    const itens = screen.getAllByRole("listitem").filter((li) => li.querySelector('[data-testid="service-card"]'))
    expect(itens.map((li) => li.textContent?.includes("Corte"))).toEqual([true, false])
  })

  it("'Mais vendidos' sem nenhuma venda explica o vazio em vez de inventar", async () => {
    renderAt("/servicos")
    fireEvent.click(await screen.findByRole("button", { name: "Mais vendidos (0)" }))
    expect(screen.getByText("Nenhuma venda no período")).toBeInTheDocument()
  })

  it("o barbeiro não vê ticket médio nem o filtro de mais vendidos (o financeiro é da gestão)", async () => {
    withShop("barbeiro")
    renderAt("/servicos")
    const stats = await screen.findByRole("region", { name: "Indicadores de serviços" })
    expect(within(stats).queryByText("Ticket médio")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Mais vendidos/ })).not.toBeInTheDocument()
    expect(mocks.fetchServiceSales).not.toHaveBeenCalled()
  })

  it("o filtro escolhido continua depois de abrir e fechar a edição", async () => {
    mocks.fetchServiceSales.mockResolvedValue({ sales: [venda("1", "s1")], payments: [], refunds: [] })
    renderAt("/servicos")
    fireEvent.click(await screen.findByRole("button", { name: "Mais vendidos (1)" }))
    fireEvent.click(await screen.findByRole("button", { name: "Editar Corte" }))
    fireEvent.click(await screen.findByRole("button", { name: "Fechar" }))
    expect(screen.getByRole("button", { name: "Mais vendidos (1)" })).toHaveAttribute("aria-pressed", "true")
  })
})

describe("Serviços", () => {
  it("lista nome, duração e preço, e marca o serviço inativo", async () => {
    renderAt("/servicos")

    expect(await screen.findByRole("heading", { level: 1, name: "Serviços" })).toBeInTheDocument()
    const corte = (await screen.findByText("Corte")).closest("li")!
    expect(corte).toHaveTextContent("40 min")
    expect(corte).toHaveTextContent(/R\$\s60,00/)
    const barba = screen.getByText("Barba").closest("li")!
    expect(barba).toHaveTextContent("1 h 30 min")
    expect(barba).toHaveTextContent(/R\$\s40,50/)
    expect(within(barba).getByText("Inativo")).toBeInTheDocument()
    expect(mocks.fetchServices).toHaveBeenCalledWith("loja-1")
  })

  it("só proprietário e gerente veem as ações de edição", async () => {
    withShop("barbeiro")
    renderAt("/servicos")

    await screen.findByText("Corte")
    expect(screen.queryByRole("button", { name: "Novo serviço" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Excluir/ })).not.toBeInTheDocument()
  })

  it("estado vazio oferece uma única ação", async () => {
    mocks.fetchServices.mockResolvedValue({ status: "ok", data: [] })
    renderAt("/servicos")

    expect(await screen.findByText("Nenhum serviço cadastrado")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Novo serviço" })).toHaveLength(1)
  })

  it("diferencia catálogo indisponível de erro, e permite tentar de novo", async () => {
    mocks.fetchServices.mockResolvedValueOnce({ status: "unavailable" })
    renderAt("/servicos")
    expect(await screen.findByText("Catálogo indisponível")).toBeInTheDocument()
  })

  it("mostra erro sem detalhes internos e recupera", async () => {
    mocks.fetchServices.mockRejectedValueOnce(new Error("detalhe interno"))
    renderAt("/servicos")

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar os serviços")
    expect(screen.queryByText(/detalhe interno/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }))
    expect(await screen.findByText("Corte")).toBeInTheDocument()
  })

  it("sem barbearia, leva a criar uma", async () => {
    mocks.fetchMyBarbershops.mockResolvedValue({ status: "ok", barbershops: [] })
    renderAt("/servicos")

    expect(await screen.findByText("Crie sua barbearia primeiro")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Criar barbearia" })).toHaveAttribute("href", "/barbearias/nova")
    expect(mocks.fetchServices).not.toHaveBeenCalled()
  })

  it("quem só é cliente não vê o catálogo de gestão", async () => {
    withShop("cliente")
    renderAt("/servicos")

    expect(await screen.findByText("Crie sua barbearia primeiro")).toBeInTheDocument()
    expect(mocks.fetchServices).not.toHaveBeenCalled()
  })

  it("cria o serviço enviando o preço em centavos", async () => {
    renderAt("/servicos")
    fireEvent.click(await screen.findByRole("button", { name: "Novo serviço" }))
    const dialog = await screen.findByRole("dialog")

    type("Nome", "Corte degradê")
    type("Preço (R$)", "65,50")
    type("Duração (minutos)", "45")
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar serviço" }))

    await waitFor(() =>
      expect(mocks.saveService).toHaveBeenCalledWith(
        "loja-1",
        { nome: "Corte degradê", descricao: null, preco_centavos: 6550, duracao_min: 45, ativo: true },
        undefined
      )
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("valida antes de enviar e liga o erro ao campo", async () => {
    renderAt("/servicos")
    fireEvent.click(await screen.findByRole("button", { name: "Novo serviço" }))
    const dialog = await screen.findByRole("dialog")

    type("Preço (R$)", "abc")
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar serviço" }))

    expect(await within(dialog).findByText("Informe o nome do serviço.")).toBeInTheDocument()
    expect(screen.getByLabelText("Preço (R$)")).toHaveAccessibleDescription("Informe um valor válido, como 60,00.")
    expect(mocks.saveService).not.toHaveBeenCalled()
  })

  it("edita um serviço existente com os valores atuais", async () => {
    renderAt("/servicos")
    fireEvent.click(await screen.findByRole("button", { name: "Editar Corte" }))
    const dialog = await screen.findByRole("dialog")

    expect(screen.getByLabelText("Nome")).toHaveValue("Corte")
    expect(screen.getByLabelText("Preço (R$)")).toHaveValue("60,00")
    expect(screen.getByLabelText("Duração (minutos)")).toHaveValue("40")
    type("Preço (R$)", "70,00") // o campo mantém o formato 00,00 sozinho
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar serviço" }))

    await waitFor(() =>
      expect(mocks.saveService).toHaveBeenCalledWith("loja-1", expect.objectContaining({ preco_centavos: 7000 }), "s1")
    )
  })

  it("informa nome repetido em vez de falhar em silêncio", async () => {
    mocks.saveService.mockRejectedValue({ code: "23505" })
    renderAt("/servicos")
    fireEvent.click(await screen.findByRole("button", { name: "Novo serviço" }))
    const dialog = await screen.findByRole("dialog")

    type("Nome", "Corte")
    type("Preço (R$)", "60")
    type("Duração (minutos)", "40")
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar serviço" }))

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Já existe um serviço com este nome.")
  })

  it("exclui só depois da confirmação", async () => {
    renderAt("/servicos")
    fireEvent.click(await screen.findByRole("button", { name: "Excluir Corte" }))
    const confirm = await screen.findByRole("alertdialog")
    expect(mocks.deleteService).not.toHaveBeenCalled()

    fireEvent.click(within(confirm).getByRole("button", { name: "Excluir serviço" }))

    await waitFor(() => expect(mocks.deleteService).toHaveBeenCalledWith("loja-1", "s1"))
  })
})

describe("Equipe", () => {
  it("lista profissionais com os serviços que atendem", async () => {
    renderAt("/equipe")

    const joao = (await screen.findByText("João")).closest("li")!
    expect(within(joao).getByText("Corte")).toBeInTheDocument()
    expect(within(joao).queryByText("Barba")).not.toBeInTheDocument()
    expect(mocks.fetchProfessionals).toHaveBeenCalledWith("loja-1")
  })

  it("cria o profissional com os serviços marcados", async () => {
    renderAt("/equipe")
    fireEvent.click(await screen.findByRole("button", { name: "Novo profissional" }))
    const dialog = await screen.findByRole("dialog")

    type("Nome", "Pedro")
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Barba" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar profissional" }))

    await waitFor(() =>
      expect(mocks.saveProfessional).toHaveBeenCalledWith("loja-1", { nome: "Pedro", ativo: true, serviceIds: ["s2"] }, undefined)
    )
  })

  it("edita com os serviços atuais já marcados", async () => {
    renderAt("/equipe")
    fireEvent.click(await screen.findByRole("button", { name: "Editar João" }))
    const dialog = await screen.findByRole("dialog")

    expect(within(dialog).getByRole("checkbox", { name: "Corte" })).toBeChecked()
    expect(within(dialog).getByRole("checkbox", { name: "Barba" })).not.toBeChecked()
  })

  it("não há vínculo manual de conta: nem no cadastro nem na edição aparecem contas de outras pessoas", async () => {
    mocks.fetchBarbers.mockResolvedValue([{ profile_id: "u9", nome: "Carlos", email: "carlos@example.test" }])
    renderAt("/equipe")
    fireEvent.click(await screen.findByRole("button", { name: "Editar João" }))
    const edicao = await screen.findByRole("dialog")
    expect(within(edicao).queryByText("Conta de acesso do barbeiro")).not.toBeInTheDocument()
    expect(within(edicao).queryByRole("radio")).not.toBeInTheDocument()
    expect(within(edicao).queryByText(/carlos@example\.test/)).not.toBeInTheDocument()
    fireEvent.click(within(edicao).getByRole("button", { name: "Salvar profissional" }))
    await waitFor(() => expect(mocks.saveProfessional).toHaveBeenCalledWith("loja-1", { nome: "João", ativo: true, serviceIds: ["s1"] }, "p1"))

    fireEvent.click(await screen.findByRole("button", { name: "Novo profissional" }))
    const novo = await screen.findByRole("dialog")
    expect(within(novo).queryByText("Conta de acesso do barbeiro")).not.toBeInTheDocument()
    expect(within(novo).queryByRole("radio")).not.toBeInTheDocument()
  })

  it("a foto preenche a coluna esquerda do card (sem quadrado fixo) e escolher uma imagem abre o ajuste antes de enviar", async () => {
    const createUrl = vi.fn(() => "blob:foto")
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() })
    renderAt("/equipe")
    const card = (await screen.findAllByTestId("professional-card"))[0]
    const foto = within(card).getByTestId("professional-photo")
    expect(foto).toHaveClass("absolute", "inset-0", "h-full", "w-full") // cobre a coluna sem ditar a altura do card
    expect(foto).not.toHaveClass("aspect-square")
    expect(foto.parentElement).toHaveClass("aspect-[3/4]") // coluna da foto em 3:4, igual ao recorte

    fireEvent.click(screen.getByRole("button", { name: "Editar João" }))
    await screen.findByRole("dialog")
    fireEvent.change(screen.getByLabelText("Enviar foto"), { target: { files: [new File(["x"], "joao.png", { type: "image/png" })] } })
    const ajuste = await screen.findByRole("dialog", { name: "Ajustar foto de João" })
    expect(within(ajuste).getByRole("heading", { name: "Ajustar foto" })).toBeInTheDocument()
    expect(within(ajuste).getByRole("group", { name: /Área de recorte da foto/ })).toHaveStyle({ aspectRatio: "0.75" }) // arrastar, em 3:4
    expect(within(ajuste).getByText(/Formato 3:4/)).toBeInTheDocument()
    expect(within(within(ajuste).getByTestId("professional-card")).getByTestId("professional-photo").parentElement).toHaveClass("aspect-[3/4]") // prévia no mesmo 3:4
    expect(within(ajuste).getByRole("slider", { name: "Zoom" })).toBeInTheDocument()
    expect(within(ajuste).getByText("Como fica no card")).toBeInTheDocument()
    expect(within(ajuste).getByTestId("professional-card")).toBeInTheDocument() // prévia no mesmo card
    expect(within(ajuste).getByRole("button", { name: "Aplicar" })).toBeInTheDocument()
    expect(uploadProfessionalAvatar).not.toHaveBeenCalled() // nada sobe antes de confirmar

    fireEvent.click(within(ajuste).getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ajustar foto de João" })).not.toBeInTheDocument())
    expect(uploadProfessionalAvatar).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeInTheDocument() // o formulário do profissional continua aberto
  })

  it("com foto salva, clicar na foto do pop-up baixa a imagem atual e abre o ajuste para reposicionar", async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:foto"), revokeObjectURL: vi.fn() })
    const fetchMock = vi.fn(async () => new Response(new Blob(["x"], { type: "image/jpeg" })))
    vi.stubGlobal("fetch", fetchMock)
    mocks.fetchProfessionals.mockResolvedValue({ status: "ok", data: [{ id: "p1", nome: "João", ativo: true, service_ids: ["s1"], avatar_path: "loja-1/p1.jpg" }] })
    renderAt("/equipe")
    fireEvent.click(await screen.findByRole("button", { name: "Editar João" }))
    const form = await screen.findByRole("dialog")
    expect(within(form).getByText("Clique na foto para reposicionar.")).toBeInTheDocument()
    fireEvent.click(within(form).getByRole("button", { name: "Ajustar foto de João" }))
    expect(await screen.findByRole("dialog", { name: "Ajustar foto de João" })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("p1.jpg"), { cache: "no-store" })
    expect(uploadProfessionalAvatar).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it("mostra a origem do cadastro antes do nome (e-mail, Google ou manual), com o texto ao passar o mouse; barbeiro não consulta", async () => {
    mocks.fetchProfessionals.mockResolvedValue({ status: "ok", data: [
      { id: "p1", nome: "João", ativo: true, service_ids: [] }, { id: "p2", nome: "Bia", ativo: true, service_ids: [] }, { id: "p3", nome: "Caio", ativo: true, service_ids: [] },
    ] })
    mocks.fetchTeamOrigins.mockResolvedValue({ p1: "email", p2: "google", p3: "manual" })
    renderAt("/equipe")
    const heading = async (nome: string) => (await screen.findByRole("heading", { name: new RegExp(nome) }))
    expect(within(await heading("João")).getByRole("img", { name: "Conta por e-mail" })).toHaveAttribute("title", "Conta por e-mail")
    expect(within(await heading("Bia")).getByRole("img", { name: "Conta Google" })).toHaveAttribute("title", "Conta Google")
    expect(within(await heading("Caio")).getByRole("img", { name: "Cadastro manual" })).toHaveAttribute("title", "Cadastro manual")
    expect(mocks.fetchTeamOrigins).toHaveBeenCalledWith("loja-1")
  })

  it("grava telefone, e-mail e CPF normalizados e recusa contato inválido", async () => {
    renderAt("/equipe")
    fireEvent.click(await screen.findByRole("button", { name: "Editar João" }))
    const dialog = await screen.findByRole("dialog")
    const salvar = () => fireEvent.click(within(dialog).getByRole("button", { name: "Salvar profissional" }))

    type("Telefone", "11 123")
    type("CPF ou CNPJ", "52998224726") // dígito verificador errado
    salvar()
    expect(await within(dialog).findByText(/Telefone inválido/)).toBeInTheDocument()
    expect(within(dialog).getByText("CPF ou CNPJ inválido.")).toBeInTheDocument()
    expect(mocks.saveProfessional).not.toHaveBeenCalled()

    type("Telefone", "5511912345678")
    type("CPF ou CNPJ", "52998224725")
    type("E-mail", "ana@exemplo.com")
    expect(screen.getByLabelText("Telefone")).toHaveValue("+55 11 91234-5678") // máscara
    expect(screen.getByLabelText("CPF ou CNPJ")).toHaveValue("529.982.247-25")
    salvar()
    await waitFor(() => expect(saveProfessionalContact).toHaveBeenCalledWith("p1", { telefone: "11912345678", email: "ana@exemplo.com", documento: "52998224725" }))
  })

  it("sem serviços cadastrados, orienta a cadastrá-los primeiro", async () => {
    mocks.fetchServices.mockResolvedValue({ status: "ok", data: [] })
    renderAt("/equipe")
    fireEvent.click(await screen.findByRole("button", { name: "Novo profissional" }))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("link", { name: "Cadastrar serviços" })).toHaveAttribute("href", "/servicos")
  })

  it("exige o nome", async () => {
    renderAt("/equipe")
    fireEvent.click(await screen.findByRole("button", { name: "Novo profissional" }))
    const dialog = await screen.findByRole("dialog")

    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar profissional" }))

    expect(await within(dialog).findByText("Informe o nome do profissional.")).toBeInTheDocument()
    expect(mocks.saveProfessional).not.toHaveBeenCalled()
  })

  it("o botão Gerar link do convite fica à esquerda de Novo profissional e abre um pop-up para criar o link", async () => {
    mocks.createInvite.mockResolvedValue("tok123")
    mocks.fetchInvites.mockResolvedValue([])
    renderAt("/equipe")
    const novo = await screen.findByRole("button", { name: "Novo profissional" })
    const convite = screen.getByRole("button", { name: "Gerar link do convite" })
    expect(convite.compareDocumentPosition(novo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy() // convite vem antes (à esquerda)

    fireEvent.click(convite)
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: "Convidar para a equipe" })).toBeInTheDocument()
    expect(within(dialog).getByRole("radio", { name: "Gerente" })).toBeInTheDocument() // proprietário convida gerente
    fireEvent.change(within(dialog).getByLabelText("Email da pessoa"), { target: { value: "novo@example.test" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Gerar link do convite" }))

    expect(await within(dialog).findByLabelText("Link do convite")).toHaveValue(`${window.location.origin}/convite?token=tok123`)
    expect(mocks.createInvite).toHaveBeenCalledWith("loja-1", "novo@example.test", "barbeiro")
  })

  it("o histórico de convites fica abaixo dos cards, fora do pop-up", async () => {
    mocks.fetchInvites.mockResolvedValue([{ id: "i1", email: "rafa@example.test", papel: "barbeiro", aceito_em: "2026-11-10T12:00:00Z", expires_at: "2026-11-17T12:00:00Z" }])
    renderAt("/equipe")
    const historico = await screen.findByRole("list", { name: "Histórico de convites" })
    expect(within(historico).getByText("rafa@example.test · Barbeiro")).toBeInTheDocument()
    expect(within(historico).getByText("Aceito")).toBeInTheDocument()
    expect(screen.getByRole("list", { name: "Profissionais" }).compareDocumentPosition(historico) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy() // abaixo dos cards

    fireEvent.click(screen.getByRole("button", { name: "Gerar link do convite" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).queryByText("Convites enviados")).not.toBeInTheDocument()
    expect(within(dialog).queryByText("rafa@example.test · Barbeiro")).not.toBeInTheDocument()
  })

  describe("copiar link no histórico", () => {
    const futuro = new Date(Date.now() + 3 * 864e5).toISOString(), passado = new Date(Date.now() - 864e5).toISOString()
    const lista = [
      { id: "i-pend", email: "pendente@example.test", papel: "barbeiro", aceito_em: null, expires_at: futuro },
      { id: "i-ger", email: "gerente@example.test", papel: "gerente", aceito_em: null, expires_at: futuro },
      { id: "i-ok", email: "aceito@example.test", papel: "barbeiro", aceito_em: passado, expires_at: futuro },
      { id: "i-exp", email: "expirado@example.test", papel: "barbeiro", aceito_em: null, expires_at: passado },
    ]
    const botao = (email: string) => screen.queryByRole("button", { name: `Copiar link do convite de ${email}` })

    it("só convites pendentes e válidos têm o botão; copiar renova o mesmo convite, copia o link e avisa (sem criar convite)", async () => {
      mocks.fetchInvites.mockResolvedValue(lista)
      mocks.renewInvite.mockResolvedValue("novo123")
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })
      const success = vi.spyOn(toast, "success")
      renderAt("/equipe")
      await screen.findByRole("list", { name: "Histórico de convites" })
      expect(botao("pendente@example.test")).toBeInTheDocument()
      expect(botao("gerente@example.test")).toBeInTheDocument() // proprietário
      expect(botao("aceito@example.test")).not.toBeInTheDocument()
      expect(botao("expirado@example.test")).not.toBeInTheDocument()

      fireEvent.click(botao("pendente@example.test")!)
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/convite?token=novo123`))
      expect(mocks.renewInvite).toHaveBeenCalledWith("i-pend")
      expect(mocks.createInvite).not.toHaveBeenCalled()
      expect(success).toHaveBeenCalledWith("Link copiado!", expect.anything())
      success.mockRestore()
    })

    it("sem área de transferência, mostra o link para copiar à mão", async () => {
      mocks.fetchInvites.mockResolvedValue(lista)
      mocks.renewInvite.mockResolvedValue("novo456")
      Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("negado")) } })
      renderAt("/equipe")
      await screen.findByRole("list", { name: "Histórico de convites" })
      fireEvent.click(botao("pendente@example.test")!)
      expect(await screen.findByLabelText("Link do convite")).toHaveValue(`${window.location.origin}/convite?token=novo456`)
    })

    it("gerente não renova convite de gerente; barbeiro nem consulta os convites", async () => {
      withShop("gerente")
      mocks.fetchInvites.mockResolvedValue(lista)
      renderAt("/equipe")
      await screen.findByRole("list", { name: "Histórico de convites" })
      expect(botao("pendente@example.test")).toBeInTheDocument()
      expect(botao("gerente@example.test")).not.toBeInTheDocument()
      cleanup()
      mocks.fetchInvites.mockClear()
      withShop("barbeiro")
      renderAt("/equipe")
      await screen.findByText("João")
      expect(screen.queryByRole("list", { name: "Histórico de convites" })).not.toBeInTheDocument()
      expect(mocks.fetchInvites).not.toHaveBeenCalled()
    })
  })

  it("o convite valida o e-mail, e o gerente só convida barbeiros", async () => {
    withShop("gerente")
    mocks.fetchInvites.mockResolvedValue([])
    renderAt("/equipe")
    fireEvent.click(await screen.findByRole("button", { name: "Gerar link do convite" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("radio", { name: "Barbeiro" })).toBeInTheDocument()
    expect(within(dialog).queryByRole("radio", { name: "Gerente" })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Gerar link do convite" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Informe um email válido.")
    expect(mocks.createInvite).not.toHaveBeenCalled()
  })

  it("barbeiro só consulta a equipe", async () => {
    withShop("barbeiro")
    renderAt("/equipe")

    await screen.findByText("João")
    expect(screen.queryByRole("button", { name: "Novo profissional" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Gerar link do convite" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Editar|Excluir/ })).not.toBeInTheDocument()
  })

  it("exclui só depois da confirmação", async () => {
    mocks.deleteProfessional.mockResolvedValue(undefined)
    renderAt("/equipe")
    fireEvent.click(await screen.findByRole("button", { name: "Excluir João" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Excluir profissional" }))

    await waitFor(() => expect(mocks.deleteProfessional).toHaveBeenCalledWith("loja-1", "p1"))
  })
})

describe("Criar barbearia", () => {
  it("sugere o endereço a partir do nome até o usuário editá-lo", async () => {
    renderAt("/barbearias/nova")

    type("Nome da barbearia", "Barbearia do João")
    expect(screen.getByLabelText("Endereço público")).toHaveValue("barbearia-do-joao")
    type("Endereço público", "meu-endereco")
    type("Nome da barbearia", "Outro nome")
    expect(screen.getByLabelText("Endereço público")).toHaveValue("meu-endereco")
  })

  it("valida e não chama o servidor com dados inválidos", async () => {
    renderAt("/barbearias/nova")

    fireEvent.click(screen.getByRole("button", { name: "Criar barbearia" }))

    expect(await screen.findByText("Informe o nome da barbearia.")).toBeInTheDocument()
    expect(mocks.createBarbershop).not.toHaveBeenCalled()
  })

  it("cria, atualiza a lista e abre o painel", async () => {
    const router = renderAt("/barbearias/nova")

    type("Nome da barbearia", "Barbearia Nova")
    fireEvent.click(screen.getByRole("button", { name: "Criar barbearia" }))

    await waitFor(() => expect(mocks.createBarbershop).toHaveBeenCalledWith("Barbearia Nova", "barbearia-nova"))
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"))
  })

  it("avisa no campo quando o endereço já está em uso", async () => {
    mocks.createBarbershop.mockRejectedValue({ code: "23505" })
    const router = renderAt("/barbearias/nova")

    type("Nome da barbearia", "Barbearia Nova")
    fireEvent.click(screen.getByRole("button", { name: "Criar barbearia" }))

    expect(await screen.findByText("Este endereço já está em uso. Escolha outro.")).toBeInTheDocument()
    expect(screen.getByLabelText("Endereço público")).toHaveAttribute("aria-invalid", "true")
    expect(router.state.location.pathname).toBe("/barbearias/nova")
  })

  it("mostra falha genérica sem detalhes internos", async () => {
    mocks.createBarbershop.mockRejectedValue(new Error("detalhe interno"))
    renderAt("/barbearias/nova")

    type("Nome da barbearia", "Barbearia Nova")
    fireEvent.click(screen.getByRole("button", { name: "Criar barbearia" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível criar a barbearia")
    expect(screen.queryByText(/detalhe interno/)).not.toBeInTheDocument()
  })
})

describe("Equipe: convites aceitos", () => {
  it("barbeiro convidado aparece como profissional e gerente aparece como membro com o papel", async () => {
    mocks.fetchBarbers.mockImplementation(async (_shop: string, papel?: string) => (papel === "gerente" ? [{ profile_id: "g1", nome: "Gina", email: "gina@example.test" }] : []))
    mocks.fetchProfessionals.mockResolvedValue({ status: "ok", data: [{ id: "p1", nome: "João", ativo: true, service_ids: ["s1"] }, { id: "p2", nome: "Rafael", ativo: true, service_ids: [] }] })
    renderAt("/equipe")
    const managers = await screen.findByRole("list", { name: "Gerentes" })
    expect(within(managers).getByText("Gina")).toBeInTheDocument()
    expect(within(managers).getByText("Gerente")).toBeInTheDocument()
    expect(within(screen.getByRole("list", { name: "Profissionais" })).getByText("Rafael")).toBeInTheDocument()
    expect(mocks.fetchBarbers).toHaveBeenCalledWith("loja-1", "gerente")
  })

  it("barbeiro (sem gestão) não vê nem busca a lista de gerentes", async () => {
    withShop("barbeiro")
    renderAt("/equipe")
    await screen.findByText("João")
    expect(screen.queryByRole("list", { name: "Gerentes" })).not.toBeInTheDocument()
    expect(mocks.fetchBarbers).not.toHaveBeenCalledWith("loja-1", "gerente")
  })
})

describe("Equipe: vagas do plano", () => {
  const usage = (ativos: number, max: number | null) => ({ plano: "inicial", status: "trial", max_profissionais: max, profissionais_ativos: ativos, trial_ate: null, periodo_fim: null, permite_novos: true })

  it("mostra os profissionais ativos contados no banco, com barra; salvar um profissional atualiza a contagem", async () => {
    mocks.fetchPlanUsage.mockResolvedValue(usage(2, 5))
    renderAt("/equipe")
    expect(await screen.findByText("Profissionais ativos: 2/5")).toBeInTheDocument()
    expect(screen.getByRole("progressbar", { name: "Profissionais ativos" })).toHaveAttribute("aria-valuenow", "2")
    expect(screen.getByRole("progressbar", { name: "Profissionais ativos" })).toHaveAttribute("aria-valuemax", "5")

    mocks.fetchPlanUsage.mockResolvedValue(usage(3, 5))
    fireEvent.click(await screen.findByRole("button", { name: "Editar João" }))
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Salvar profissional" }))
    expect(await screen.findByText("Profissionais ativos: 3/5")).toBeInTheDocument()
  })

  it("4/5: Novo profissional abre o cadastro normalmente", async () => {
    mocks.fetchPlanUsage.mockResolvedValue(usage(4, 5))
    renderAt("/equipe")
    expect(await screen.findByText("Profissionais ativos: 4/5")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Novo profissional" }))
    expect(await screen.findByRole("heading", { name: "Novo profissional" })).toBeInTheDocument()
    expect(screen.queryByText("Limite de profissionais atingido")).not.toBeInTheDocument()
  })

  it("5/5: cadastrar o sexto abre o pop-up do limite com o WhatsApp e a mensagem com o nome da barbearia", async () => {
    mocks.fetchPlanUsage.mockResolvedValue(usage(5, 5))
    renderAt("/equipe")
    expect(await screen.findByText("Profissionais ativos: 5/5")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Novo profissional" }))
    const dialog = await screen.findByRole("dialog", { name: "Limite de profissionais atingido" })
    expect(within(dialog).getByText("Sua barbearia atingiu o limite de 5 profissionais. Para aumentar a capacidade da equipe, entre em contato com o desenvolvedor.")).toBeInTheDocument()
    const link = within(dialog).getByRole("link", { name: "Conversar pelo WhatsApp" })
    const href = link.getAttribute("href") ?? ""
    expect(href.startsWith("https://wa.me/5564993296649?text=")).toBe(true)
    expect(new URL(href).searchParams.get("text")).toBe("Olá! Sou responsável pela barbearia Barbearia Teste e gostaria de aumentar o limite de profissionais da minha equipe. Podem me ajudar?")
    expect(link).toHaveAttribute("target", "_blank")
    expect(screen.queryByRole("heading", { name: "Novo profissional" })).not.toBeInTheDocument()
    expect(mocks.saveProfessional).not.toHaveBeenCalled()
  })

  it("ativar acima do limite: o servidor recusa (plan_limit) e aparece o pop-up do limite, não o erro no formulário", async () => {
    mocks.fetchPlanUsage.mockResolvedValue(usage(5, 5))
    mocks.fetchProfessionals.mockResolvedValue({ status: "ok", data: [{ id: "p1", nome: "João", ativo: false, service_ids: ["s1"] }] })
    mocks.saveProfessional.mockRejectedValue({ message: "plan_limit" })
    renderAt("/equipe")
    fireEvent.click(await screen.findByRole("button", { name: "Editar João" }))
    const form = await screen.findByRole("dialog")
    fireEvent.click(within(form).getByRole("checkbox", { name: "Profissional ativo" }))
    fireEvent.click(within(form).getByRole("button", { name: "Salvar profissional" }))
    expect(await screen.findByRole("dialog", { name: "Limite de profissionais atingido" })).toBeInTheDocument()
    expect(mocks.fetchPlanUsage.mock.calls.length).toBeGreaterThan(1) // contador consultado de novo
  })

  it("plano sem limite mostra só a contagem, sem barra", async () => {
    mocks.fetchPlanUsage.mockResolvedValue(usage(7, null))
    renderAt("/equipe")
    expect(await screen.findByText("Profissionais ativos: 7 (sem limite)")).toBeInTheDocument()
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })

  it("barbeiro (sem gestão) não vê nem consulta as vagas", async () => {
    withShop("barbeiro")
    renderAt("/equipe")
    await screen.findByText("João")
    expect(screen.queryByText(/Profissionais ativos/)).not.toBeInTheDocument()
    expect(mocks.fetchPlanUsage).not.toHaveBeenCalled()
    expect(mocks.fetchTeamOrigins).not.toHaveBeenCalled() // origem do cadastro: só a gestão
  })
})
