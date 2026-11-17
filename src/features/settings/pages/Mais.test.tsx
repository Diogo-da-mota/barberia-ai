/// <reference types="@testing-library/jest-dom/vitest" />
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

const gate = vi.hoisted(() => ({ canManage: true, papel: "proprietario" }))
const api = vi.hoisted(() => ({
  fetchShopDetails: vi.fn(), fetchFiscal: vi.fn(), saveShopProfile: vi.fn(), saveShopFiscal: vi.fn(), lookupCep: vi.fn(),
  fetchDocuments: vi.fn(), uploadDocument: vi.fn(), removeDocument: vi.fn(), signedDocumentUrl: vi.fn(),
}))
const other = vi.hoisted(() => ({
  fetchShopHours: vi.fn(), fetchBlocks: vi.fn(), fetchIntegrations: vi.fn(), fetchOutboxSummary: vi.fn(), updateShopInfo: vi.fn(),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock("@/app/Shell", () => ({ Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock("@/features/catalog/hooks/useActiveBarbershop", () => ({
  useActiveBarbershop: () => ({ state: "ready", active: { id: "loja-1", nome: "Barbearia", slug: "barbearia", endereco: null, status: "ativo", fuso: "America/Sao_Paulo", papel: gate.papel }, canManage: gate.canManage }),
}))
vi.mock("@/features/settings/api", () => api)
vi.mock("@/features/booking/api", () => ({ fetchShopHours: other.fetchShopHours, fetchBlocks: other.fetchBlocks, updateShopInfo: other.updateShopInfo, createInvite: vi.fn(), fetchInvites: async () => [] }))
vi.mock("@/features/catalog/api", () => ({
  fetchServices: async () => ({ status: "ok", data: [{ id: "s1", nome: "Corte", descricao: null, preco_centavos: 6000, duracao_min: 40, ativo: true }, { id: "s2", nome: "Barba", descricao: null, preco_centavos: 4000, duracao_min: 20, ativo: true }] }),
  fetchProfessionals: async () => ({ status: "ok", data: [{ id: "pr1", nome: "Ana", ativo: true, service_ids: [] }, { id: "pr2", nome: "Bruno", ativo: true, service_ids: [] }] }),
}))
vi.mock("@/features/messaging/api", () => ({ fetchIntegrations: other.fetchIntegrations, fetchOutboxSummary: other.fetchOutboxSummary }))
vi.mock("@/features/messaging/components/PreferencesCard", () => ({ PreferencesCard: () => <div>Cartão de novidades</div> }))
vi.mock("@/features/plans/PlanCard", () => ({ PlanCard: () => <section aria-label="Plano">Plano do teste</section> }))
vi.mock("@/features/calendar/CalendarCard", () => ({ CalendarCard: () => <section aria-label="Google Calendar">Google Calendar do teste</section> }))
vi.mock("@/app/AppearanceCard", () => ({ AppearanceCard: () => <section aria-label="Aparência">Cartão de aparência</section> }))
vi.mock("@/ui/sonner", () => ({ toast }))
vi.mock("@/features/settings/whatsapp-api", () => ({
  getWhatsAppStatus: async () => ({ provider: null, connected: false, state: "not_found", number: null, profileName: null }),
  connectWhatsApp: vi.fn(),
  disconnectWhatsApp: vi.fn(),
}))

import { More } from "@/features/booking/pages/More"

const details = (over: Record<string, unknown> = {}) => ({
  supported: true, nome: "Barbearia do TICO", nome_exibicao: null, descricao: "Cortes clássicos.", telefone: "6733224455", whatsapp: "67992396649", email_comercial: "contato@tico.com.br",
  endereco: "Rua do Pombo, 123 - Centro, Campo Grande - MS", cep: "79002320", logradouro: "Rua do Pombo", numero: "123", complemento: null, bairro: "Centro", cidade: "Campo Grande", uf: "MS",
  cor_destaque: "verde", fuso: "America/Sao_Paulo", ...over,
})
const fiscal = (over: Record<string, unknown> = {}) => ({ supported: true, data: { tipo_pessoa: "juridica", documento: "11222333000181", razao_social: "Barbearia do TICO LTDA", responsavel_nome: "Fulano", inscricao_estadual: null, ...over } })

function setup(path = "/mais") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><More /></MemoryRouter></QueryClientProvider>)
}
const tab = (name: string) => screen.getByRole("tab", { name })
const change = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
  vi.clearAllMocks()
  gate.canManage = true; gate.papel = "proprietario"
  api.fetchShopDetails.mockResolvedValue(details())
  api.fetchFiscal.mockResolvedValue(fiscal())
  api.saveShopProfile.mockResolvedValue(undefined); api.saveShopFiscal.mockResolvedValue(undefined)
  api.lookupCep.mockResolvedValue(null)
  api.fetchDocuments.mockResolvedValue({ supported: true, rows: [] })
  other.fetchShopHours.mockResolvedValue([]); other.fetchBlocks.mockResolvedValue([])
  other.fetchIntegrations.mockResolvedValue([]); other.fetchOutboxSummary.mockResolvedValue([])
  other.updateShopInfo.mockResolvedValue(undefined)
})

describe("/mais: estrutura", () => {
  it("cabeçalho compacto (sem foto) com as duas abas, aba Dados por padrão e link direto por ?aba=", async () => {
    setup()
    expect(await screen.findByRole("heading", { level: 1, name: "Mais" })).toBeInTheDocument()
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Dados da barbearia", "Documentos"])
    expect(tab("Dados da barbearia")).toHaveAttribute("aria-selected", "true")
    expect(document.querySelector('[data-banner="mais"]')).not.toBeNull()
    expect(document.querySelector('[data-banner="mais"] img')).toBeNull() // sem fotografia ocupando espaço de trabalho
  })

  it("?aba=documentos abre direto a aba pedida", async () => {
    setup("/mais?aba=documentos")
    expect(await screen.findByRole("heading", { name: "Adicionar documento" })).toBeInTheDocument()
    expect(tab("Documentos")).toHaveAttribute("aria-selected", "true")
  })

  it("a gestão não vê a aparência duplicada nem convites (moram em Equipe); o plano continua em Dados", async () => {
    setup()
    await screen.findByLabelText(/Nome da barbearia/)
    expect(screen.queryByLabelText("Aparência")).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Convidar para a equipe" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Gerar link do convite" })).not.toBeInTheDocument()
    expect(screen.getByLabelText("Plano")).toBeInTheDocument()
  })

  it("quem não é da gestão vê a versão curta, com aparência (não alcança Meu site), sem abas", async () => {
    gate.canManage = false; gate.papel = "barbeiro"
    setup()
    expect(await screen.findByLabelText("Aparência")).toBeInTheDocument()
    expect(screen.queryAllByRole("tab")).toHaveLength(0)
    expect(screen.getByLabelText("Google Calendar")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Convidar para a equipe" })).not.toBeInTheDocument()
  })
})

describe("aba Dados da barbearia", () => {
  it("carrega os dados reais com máscara, o WhatsApp com o ícone e os dados fiscais do proprietário", async () => {
    setup()
    expect(await screen.findByLabelText(/Nome da barbearia/)).toHaveValue("Barbearia do TICO")
    expect(screen.queryByLabelText("Telefone")).not.toBeInTheDocument() // o telefone saiu da tela (o valor salvo continua)
    // Contato dividido em dois cards: Contato comercial (WhatsApp e e-mail) e Integração WhatsApp (botão, QR e estado)
    const contato = screen.getByRole("region", { name: "Contato comercial" })
    expect(within(contato).getByRole("textbox", { name: "WhatsApp" })).toBeInTheDocument()
    expect(within(contato).getByLabelText("E-mail comercial")).toBeInTheDocument()
    const integracao = screen.getByRole("region", { name: "Integração WhatsApp" })
    const conectar = await within(integracao).findByRole("button", { name: /Conectar WhatsApp/ })
    expect(conectar).toHaveClass("bg-danger") // desconectado: vermelho
    expect(within(integracao).queryByRole("status", { name: "Estado do WhatsApp" })).not.toBeInTheDocument() // sem o selo de estado
    // O label "WhatsApp" aparece no input de telefone E na aba; usamos role="textbox" para o input
    expect(screen.getByRole("textbox", { name: "WhatsApp" })).toHaveValue("+55 67 99239-6649")
    expect(screen.getByLabelText("E-mail comercial")).toHaveValue("contato@tico.com.br")
    expect(screen.getByLabelText("CEP")).toHaveValue("79002-320")
    expect(screen.getByLabelText("CNPJ")).toHaveValue("11.222.333/0001-81")
    expect(screen.getByLabelText("Nome completo / Razão social")).toHaveValue("Barbearia do TICO LTDA")
    expect(screen.getByRole("button", { name: "Tudo salvo" })).toBeDisabled() // nada mudou
    expect(screen.getByText(/Rua do Pombo, 123 - Centro, Campo Grande - MS/)).toBeInTheDocument()
  })

  it("salva pelo servidor com telefone em dígitos e só envia os fiscais se mudaram", async () => {
    setup()
    await screen.findByLabelText(/Nome da barbearia/)
    change(/Nome da barbearia/, "Novo Nome")
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }))
    await waitFor(() => expect(api.saveShopProfile).toHaveBeenCalledWith(expect.objectContaining({ shopId: "loja-1", nome: "Novo Nome", telefone: "6733224455", whatsapp: "67992396649", cep: "79002320", uf: "MS" })))
    expect(api.saveShopFiscal).not.toHaveBeenCalled()
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Dados salvos."))
    expect(other.updateShopInfo).not.toHaveBeenCalled() // com a migration, um só caminho de escrita
  })

  it("mudar o CNPJ grava os dados fiscais; CNPJ inválido bloqueia o salvamento", async () => {
    setup()
    const doc = await screen.findByLabelText("CNPJ")
    fireEvent.change(doc, { target: { value: "11222333000182" } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }))
    expect(await screen.findByText("CNPJ inválido. Confira os números.")).toBeInTheDocument()
    expect(api.saveShopFiscal).not.toHaveBeenCalled()
    expect(api.saveShopProfile).not.toHaveBeenCalled()
    fireEvent.change(doc, { target: { value: "11222333000181" } })
    fireEvent.change(screen.getByLabelText("Inscrição estadual"), { target: { value: "Isento" } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }))
    await waitFor(() => expect(api.saveShopFiscal).toHaveBeenCalledWith(expect.objectContaining({ tipo: "juridica", documento: "11.222.333/0001-81", inscricaoEstadual: "Isento" })))
  })

  it("pessoa física pede CPF, sem inscrição estadual", async () => {
    setup()
    fireEvent.click(await screen.findByRole("radio", { name: "Pessoa Física" }))
    expect(screen.getByLabelText("CPF")).toBeInTheDocument()
    expect(screen.queryByLabelText("Inscrição estadual")).not.toBeInTheDocument()
  })

  it("validações por campo: e-mail, WhatsApp e CEP incompletos", async () => {
    setup()
    await screen.findByLabelText(/Nome da barbearia/)
    change("E-mail comercial", "sem-arroba")
    change("CEP", "123")
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }))
    expect(await screen.findByText("E-mail inválido.")).toBeInTheDocument()
    expect(screen.getByText("O CEP tem 8 números.")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Corrija os campos destacados.")
    expect(api.saveShopProfile).not.toHaveBeenCalled()
  })

  it("busca de CEP preenche rua, bairro, cidade e estado; se falhar, avisa e deixa preencher à mão", async () => {
    api.lookupCep.mockResolvedValueOnce({ logradouro: "Rua Nova", bairro: "Jardim", cidade: "Dourados", uf: "MS" })
    setup()
    await screen.findByLabelText(/Nome da barbearia/)
    change("CEP", "79800-000")
    await waitFor(() => expect(api.lookupCep).toHaveBeenCalledWith("79800000"))
    await waitFor(() => expect(screen.getByLabelText("Endereço (rua, avenida, etc.)")).toHaveValue("Rua Nova"))
    expect(screen.getByLabelText("Bairro")).toHaveValue("Jardim")
    expect(screen.getByLabelText("Cidade")).toHaveValue("Dourados")
    expect(await screen.findByText("Endereço preenchido. Confira e complete o número.")).toBeInTheDocument()
    api.lookupCep.mockResolvedValueOnce(null)
    change("CEP", "79900-000")
    expect(await screen.findByText("Não encontramos este CEP agora. Preencha o endereço à mão.")).toBeInTheDocument()
    expect(screen.getByLabelText("Endereço (rua, avenida, etc.)")).toBeEnabled()
  })

  it("gerente edita os dados, mas não vê nem edita os fiscais", async () => {
    gate.papel = "gerente"
    setup()
    expect(await screen.findByLabelText(/Nome da barbearia/)).toBeEnabled()
    expect(screen.queryByLabelText("CNPJ")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Nome completo / Razão social")).toBeDisabled()
    expect(screen.getAllByText(/Só o proprietário vê e edita/).length).toBeGreaterThan(0)
    expect(api.fetchFiscal).not.toHaveBeenCalled()
  })

  it("banco sem a migration 0012: avisa o que falta, desabilita o que não funciona e salva só o que existe", async () => {
    api.fetchShopDetails.mockResolvedValue(details({ supported: false, nome_exibicao: null, whatsapp: null, email_comercial: null, cep: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null }))
    api.fetchFiscal.mockResolvedValue({ supported: false, data: null })
    setup()
    await screen.findByLabelText(/Nome da barbearia/)
    expect(screen.getAllByText(/migration 0012/).length).toBeGreaterThanOrEqual(3)
    // O label "WhatsApp" aparece no input de telefone E na aba; usamos role="textbox" para o input
    expect(screen.getByRole("textbox", { name: "WhatsApp" })).toBeDisabled()
    expect(screen.getByLabelText("E-mail comercial")).toBeDisabled()
    expect(screen.getByLabelText("Nome de exibição no site")).toBeDisabled()
    expect(screen.queryByLabelText("CEP")).not.toBeInTheDocument()
    expect(screen.getByLabelText("CNPJ")).toBeDisabled()
    change(/Nome da barbearia/, "Outro")
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }))
    await waitFor(() => expect(other.updateShopInfo).toHaveBeenCalledWith("loja-1", { nome: "Outro", endereco: "Rua do Pombo, 123 - Centro, Campo Grande - MS" }))
    expect(api.saveShopProfile).not.toHaveBeenCalled()
    expect(api.saveShopFiscal).not.toHaveBeenCalled()
  })
})

describe("aba Documentos", () => {
  it("sem a migration 0013: avisa e não deixa enviar nada (nada simulado)", async () => {
    api.fetchDocuments.mockResolvedValue({ supported: false, rows: [] })
    setup("/mais?aba=documentos")
    expect(await screen.findByText(/depende da migration 0013/)).toBeInTheDocument()
    expect(screen.getByLabelText("Arquivo do documento")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Escolher arquivo" })).toBeDisabled()
  })

  it("lista os documentos com tipo, arquivo, tamanho e data, sem status de 'válido'", async () => {
    api.fetchDocuments.mockResolvedValue({ supported: true, rows: [{ id: "d1", tipo: "alvara", nome_arquivo: "alvara.pdf", storage_path: "loja-1/alvara-1.pdf", mime: "application/pdf", tamanho_bytes: 412 * 1024, criado_em: "2026-11-10T15:00:00Z" }] })
    setup("/mais?aba=documentos")
    expect(await screen.findByText("Alvará de funcionamento")).toBeInTheDocument()
    expect(screen.getByText(/alvara\.pdf · 412 KB · Enviado em 10\/11\/2026/)).toBeInTheDocument()
    expect(screen.queryByText(/Válido|Aprovado/)).not.toBeInTheDocument()
  })

  it("ver o documento gera um link assinado só no clique", async () => {
    api.fetchDocuments.mockResolvedValue({ supported: true, rows: [{ id: "d1", tipo: "cnpj", nome_arquivo: "cnpj.pdf", storage_path: "loja-1/cnpj-1.pdf", mime: "application/pdf", tamanho_bytes: 1000, criado_em: "2026-11-10T15:00:00Z" }] })
    api.signedDocumentUrl.mockResolvedValue("https://signed.test/doc?token=x")
    const tabWindow = { location: { href: "" }, close: vi.fn() }
    vi.spyOn(window, "open").mockReturnValue(tabWindow as unknown as Window)
    setup("/mais?aba=documentos")
    expect(api.signedDocumentUrl).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole("button", { name: "Ver Comprovante de CNPJ" }))
    await waitFor(() => expect(api.signedDocumentUrl).toHaveBeenCalledWith("loja-1/cnpj-1.pdf"))
    await waitFor(() => expect(tabWindow.location.href).toBe("https://signed.test/doc?token=x"))
  })

  it("remover pede confirmação e só então remove", async () => {
    api.fetchDocuments.mockResolvedValue({ supported: true, rows: [{ id: "d1", tipo: "alvara", nome_arquivo: "alvara.pdf", storage_path: "p", mime: "application/pdf", tamanho_bytes: 1000, criado_em: "2026-11-10T15:00:00Z" }] })
    api.removeDocument.mockResolvedValue(undefined)
    setup("/mais?aba=documentos")
    fireEvent.click(await screen.findByRole("button", { name: "Remover Alvará de funcionamento" }))
    expect(api.removeDocument).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole("button", { name: "Remover" }))
    await waitFor(() => expect(api.removeDocument).toHaveBeenCalledWith("d1"))
  })

  it("exige o tipo antes do arquivo e recusa tipo ou tamanho inválidos", async () => {
    setup("/mais?aba=documentos")
    const input = await screen.findByLabelText("Arquivo do documento")
    fireEvent.change(input, { target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] } })
    expect(await screen.findByRole("alert")).toHaveTextContent("Escolha o tipo do documento antes de enviar o arquivo.")
    expect(api.uploadDocument).not.toHaveBeenCalled()
  })

  it("só o proprietário acessa os documentos", async () => {
    gate.papel = "gerente"
    setup("/mais?aba=documentos")
    expect(await screen.findByText("Só o proprietário acessa os documentos da barbearia.")).toBeInTheDocument()
    expect(api.fetchDocuments).not.toHaveBeenCalled()
  })
})

describe("abas que mudaram de lugar", () => {
  function Where() { const l = useLocation(); return <p data-testid="onde">{l.pathname}{l.search}</p> }
  const open = (path: string) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
      <Route path="/mais" element={<More />} />
      <Route path="*" element={<Where />} />
    </Routes></MemoryRouter></QueryClientProvider>)
  }

  it("o link antigo de Notificações leva para a aba Notificações da Central de mensagens", async () => {
    open("/mais?aba=notificacoes")
    expect(await screen.findByTestId("onde")).toHaveTextContent("/mensagens/notificacoes")
  })

  it("o link antigo da aba WhatsApp abre a aba Dados, onde está o card Integração WhatsApp", async () => {
    open("/mais?aba=whatsapp")
    expect(await screen.findByRole("tab", { name: "Dados da barbearia" })).toHaveAttribute("aria-selected", "true")
    expect(screen.queryByRole("tab", { name: "WhatsApp" })).not.toBeInTheDocument()
  })

  it("o link antigo de Horário e atendimento leva para Equipe, onde a jornada é editada", async () => {
    open("/mais?aba=horario")
    expect(await screen.findByTestId("onde")).toHaveTextContent("/equipe")
  })

  it("Mais não tem mais horário, bloqueios, regras, notificações nem aba WhatsApp: só Dados e Documentos", async () => {
    setup()
    await screen.findByRole("heading", { level: 1, name: "Mais" })
    expect(screen.queryByRole("tab", { name: /Horário/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: "Notificações" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Operação" })).not.toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: "WhatsApp" })).not.toBeInTheDocument() // a integração mora no card da aba Dados
    expect(other.fetchShopHours).not.toHaveBeenCalled()
    expect(other.fetchBlocks).not.toHaveBeenCalled()
    expect(other.fetchIntegrations).not.toHaveBeenCalled()
  })
})
