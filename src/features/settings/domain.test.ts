import { describe, expect, it } from "vitest"
import { UFS, cepDigits, composeAddress, formatBytes, formatCep, parseViaCep, validateDocumentFile, validateShopForm, type ShopForm } from "./domain"

const form = (over: Partial<ShopForm> = {}): ShopForm => ({
  nome: "Barbearia", nomeExibicao: "", razaoSocial: "", descricao: "", telefone: "", whatsapp: "", email: "", cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "",
  tipoPessoa: "juridica", documento: "", inscricaoEstadual: "", ...over,
})

describe("máscaras e endereço", () => {
  it("CEP: só números, máscara 00000-000", () => {
    expect(cepDigits("79.002-320x9")).toBe("79002320")
    expect(formatCep("79002320")).toBe("79002-320")
    expect(formatCep("7900")).toBe("7900")
  })
  it("o endereço único é montado das partes, como no servidor", () => {
    expect(composeAddress({ logradouro: "Rua do Pombo", numero: "123", bairro: "Centro", cidade: "Campo Grande", uf: "ms" })).toBe("Rua do Pombo, 123 - Centro, Campo Grande - MS")
    expect(composeAddress({ logradouro: "Rua do Pombo", numero: "", bairro: "", cidade: "", uf: "" })).toBe("Rua do Pombo")
    expect(composeAddress({ logradouro: "", numero: "", bairro: "", cidade: "Campo Grande", uf: "MS" })).toBe("Campo Grande - MS")
    expect(composeAddress({ logradouro: "", numero: "", bairro: "", cidade: "", uf: "" })).toBeNull()
  })
  it("27 unidades da federação", () => expect(UFS).toHaveLength(27))
})

describe("ViaCEP", () => {
  it("converte a resposta e trata CEP inexistente ou resposta estranha", () => {
    expect(parseViaCep({ logradouro: "Rua do Pombo", bairro: "Centro", localidade: "Campo Grande", uf: "ms" })).toEqual({ logradouro: "Rua do Pombo", bairro: "Centro", cidade: "Campo Grande", uf: "MS" })
    expect(parseViaCep({ erro: true })).toBeNull()
    expect(parseViaCep(null)).toBeNull()
    expect(parseViaCep("x")).toBeNull()
    expect(parseViaCep({})).toBeNull()
  })
})

describe("validação do formulário", () => {
  it("nome é obrigatório e o resto é opcional", () => {
    expect(validateShopForm(form({ nome: " " }), { details: true, fiscal: true }).nome).toBe("Informe o nome da barbearia.")
    expect(validateShopForm(form(), { details: true, fiscal: true })).toEqual({})
  })
  it("telefone, WhatsApp, e-mail, CEP e estado", () => {
    const e = validateShopForm(form({ telefone: "+55 11 123", whatsapp: "abc", email: "sem-arroba", cep: "123", uf: "XX" }), { details: true, fiscal: false })
    expect(Object.keys(e).sort()).toEqual(["cep", "email", "telefone", "uf", "whatsapp"])
    expect(validateShopForm(form({ telefone: "+55 67 3322-4455", whatsapp: "+55 67 99239-6649", email: "a@b.co", cep: "79002-320", uf: "MS" }), { details: true, fiscal: false })).toEqual({})
  })
  it("sem as colunas novas, só nome, descrição e telefone são conferidos", () => {
    expect(validateShopForm(form({ whatsapp: "abc", email: "x", cep: "1" }), { details: false, fiscal: false })).toEqual({})
  })
  it("CPF e CNPJ com dígito verificador, conforme o tipo de pessoa", () => {
    expect(validateShopForm(form({ tipoPessoa: "fisica", documento: "529.982.247-25" }), { details: true, fiscal: true })).toEqual({})
    expect(validateShopForm(form({ tipoPessoa: "fisica", documento: "529.982.247-26" }), { details: true, fiscal: true }).documento).toBe("CPF inválido. Confira os números.")
    expect(validateShopForm(form({ tipoPessoa: "juridica", documento: "11.222.333/0001-81" }), { details: true, fiscal: true })).toEqual({})
    expect(validateShopForm(form({ tipoPessoa: "juridica", documento: "11.222.333/0001-82" }), { details: true, fiscal: true }).documento).toBe("CNPJ inválido. Confira os números.")
    expect(validateShopForm(form({ tipoPessoa: "juridica", documento: "529.982.247-25" }), { details: true, fiscal: true }).documento).toBeTruthy() // CPF em campo de CNPJ
    expect(validateShopForm(form({ tipoPessoa: "juridica", documento: "00.000.000/0000-00" }), { details: true, fiscal: true }).documento).toBeTruthy()
    expect(validateShopForm(form({ documento: "123" }), { details: true, fiscal: false })).toEqual({}) // sem permissão fiscal, o campo nem é validado
  })
})

describe("arquivo de documento", () => {
  it("só PDF, JPG e PNG até 10 MB", () => {
    expect(validateDocumentFile({ type: "application/pdf", size: 1000 })).toBeNull()
    expect(validateDocumentFile({ type: "image/png", size: 10 * 1024 * 1024 })).toBeNull()
    expect(validateDocumentFile({ type: "image/png", size: 10 * 1024 * 1024 + 1 })).toMatch(/10 MB/)
    expect(validateDocumentFile({ type: "application/x-msdownload", size: 10 })).toMatch(/PDF, JPG ou PNG/)
    expect(validateDocumentFile({ type: "image/jpeg", size: 0 })).toMatch(/vazio/)
  })
  it("tamanho legível", () => {
    expect(formatBytes(500)).toBe("500 B")
    expect(formatBytes(412 * 1024)).toBe("412 KB")
    expect(formatBytes(1.2 * 1024 * 1024)).toBe("1,2 MB")
  })
})
