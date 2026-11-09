import { describe, expect, it } from "vitest"
import { PHONE_PLACEHOLDER, formatDocumento, formatPhone, isEmail, phoneDigits, validateDocumento, validatePhone } from "./br"

describe("telefone do Brasil", () => {
  it("formata enquanto digita: +55 DD NNNN-NNNN (fixo) e +55 DD NNNNN-NNNN (celular)", () => {
    expect(formatPhone("")).toBe("")
    expect(formatPhone("1")).toBe("+55 1")
    expect(formatPhone("11")).toBe("+55 11")
    expect(formatPhone("113234")).toBe("+55 11 3234")
    expect(formatPhone("1132345678")).toBe("+55 11 3234-5678")
    expect(formatPhone("11912345678")).toBe("+55 11 91234-5678")
  })
  it("aceita com ou sem +55 e com máscara colada", () => {
    expect(formatPhone("+55 11 91234-5678")).toBe("+55 11 91234-5678")
    expect(formatPhone("5511912345678")).toBe("+55 11 91234-5678")
    expect(formatPhone("(11) 3234-5678")).toBe("+55 11 3234-5678")
    expect(phoneDigits("+55 11 91234-5678")).toBe("11912345678")
    expect(phoneDigits("11 3234-5678")).toBe("1132345678")
  })
  it("digitar tecla a tecla com o +55 fixo no campo: cada tecla é só o número nacional", () => {
    const digitar = (numero: string) => numero.split("").reduce((campo, tecla) => formatPhone(campo + tecla), "")
    expect(digitar("11912345678")).toBe("+55 11 91234-5678")
    expect(digitar("1132345678")).toBe("+55 11 3234-5678")
    expect(digitar("55999990000")).toBe("+55 55 99999-0000") // 55 é DDD (RS): não pode virar o prefixo do país
    expect(digitar("5")).toBe("+55 5")
    expect(digitar("55")).toBe("+55 55")
    expect(digitar("555")).toBe("+55 55 5")
    expect(phoneDigits("+55 55 99999-0000")).toBe("55999990000")
    expect(phoneDigits("+55 55 3234-5678")).toBe("5532345678")
  })

  it("apagar teclas volta ao campo vazio sem deixar o +55 preso", () => {
    expect(formatPhone("+55 1")).toBe("+55 1")
    expect(formatPhone("+55 ")).toBe("")
    expect(formatPhone("+55")).toBe("")
    expect(formatPhone("+5")).toBe("+55 5") // prefixo cortado: o que sobrou é número
  })

  it("aceita o 0 antes do DDD (como em 064 99329-6649) e formata sempre no padrão +55", () => {
    expect(phoneDigits("064 99329-6649")).toBe("64993296649")
    expect(formatPhone("064 99329-6649")).toBe("+55 64 99329-6649")
    expect(validatePhone("064 99329-6649")).toBe(true)
  })

  it("digitar só zeros mostra o padrão sem inventar dígitos: 00000000000 → +55 00 00000-0000", () => {
    expect(formatPhone("00000000000")).toBe("+55 00 00000-0000")
    expect(PHONE_PLACEHOLDER).toBe("+55 00 00000-0000")
  })

  it("valida fixo (8 dígitos, 2 a 5) e celular (9 dígitos, começando em 9)", () => {
    expect(validatePhone("11 3234-5678")).toBe(true)
    expect(validatePhone("+55 11 91234-5678")).toBe(true)
    for (const ruim of ["123", "11 1234-5678", "01 91234-5678", "11 91234-567", "11 9123-4567", "abc"]) expect(validatePhone(ruim), ruim).toBe(false)
    expect(validatePhone("")).toBe(true) // opcional
  })
})

describe("CPF e CNPJ", () => {
  it("formata CPF com 11 dígitos e CNPJ com 14, enquanto digita", () => {
    expect(formatDocumento("529")).toBe("529")
    expect(formatDocumento("5299")).toBe("529.9")
    expect(formatDocumento("52998224725")).toBe("529.982.247-25")
    expect(formatDocumento("112223330001")).toBe("11.222.333/0001")
    expect(formatDocumento("11222333000181")).toBe("11.222.333/0001-81")
    expect(formatDocumento("112223330001819999")).toBe("11.222.333/0001-81") // limita a 14 dígitos
  })
  it("valida o dígito verificador", () => {
    expect(validateDocumento("529.982.247-25")).toBe(true)
    expect(validateDocumento("11.222.333/0001-81")).toBe(true)
    for (const ruim of ["529.982.247-26", "111.111.111-11", "11.222.333/0001-82", "00.000.000/0000-00", "123", "5299822472"]) expect(validateDocumento(ruim), ruim).toBe(false)
    expect(validateDocumento("")).toBe(true) // opcional
  })
})

describe("e-mail", () => {
  it("valida formato simples", () => {
    expect(isEmail("ana@exemplo.com")).toBe(true)
    expect(isEmail("")).toBe(true)
    for (const ruim of ["sem-arroba", "a@b", "a b@c.com", "@x.com"]) expect(isEmail(ruim), ruim).toBe(false)
  })
})
