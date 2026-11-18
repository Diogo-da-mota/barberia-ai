import { describe, expect, it } from "vitest"
import type { MyBarbershop } from "@/features/home/domain"
import { canRequestDeletion, DELETION_EFFECTS, leavableShops, leaveErrorMessage, loginMethods, needsReauth, ownedShops } from "./account"

const shop = (id: string, papel: MyBarbershop["papel"]): MyBarbershop => ({ id, nome: id, slug: id, endereco: null, status: "ativo", papel })

describe("conta: sair da barbearia e excluir (0057)", () => {
  it("só equipe sem ser dona sai por conta própria; dono aparece à parte", () => {
    const list = [shop("a", "barbeiro"), shop("b", "gerente"), shop("c", "proprietario"), shop("d", "cliente")]
    expect(leavableShops(list).map((s) => s.id)).toEqual(["a", "b"])
    expect(ownedShops(list).map((s) => s.id)).toEqual(["c"])
  })

  it("reautenticação e pedido de exclusão vêm só dos códigos do servidor", () => {
    expect(needsReauth({ message: "reauth_required" })).toBe(true)
    expect(needsReauth({ message: "owner_cannot_delete" })).toBe(false)
    expect(canRequestDeletion({ message: "owner_cannot_delete" })).toBe(true)
    expect(canRequestDeletion({ message: "has_upcoming_bookings" })).toBe(true)
    expect(canRequestDeletion({ message: "detalhe interno" })).toBe(false)
    expect(canRequestDeletion(null)).toBe(false)
  })

  it("mensagens de saída sem detalhe interno do servidor", () => {
    expect(leaveErrorMessage({ message: "owner_cannot_leave" })).toMatch(/proprietário não sai/)
    expect(leaveErrorMessage({ message: "relation x does not exist" })).toBe("Não foi possível sair da barbearia. Tente novamente.")
  })

  it("forma de confirmar a identidade segue o login da conta", () => {
    expect(loginMethods({ app_metadata: { providers: ["email"] } })).toEqual({ password: true, google: false })
    expect(loginMethods({ app_metadata: { providers: ["google"] } })).toEqual({ password: false, google: true })
    expect(loginMethods({ app_metadata: { provider: "google" } })).toEqual({ password: false, google: true })
    expect(loginMethods({ app_metadata: { providers: ["email", "google"] } })).toEqual({ password: true, google: true })
    expect(loginMethods(null)).toEqual({ password: false, google: false })
  })

  it("o pop-up diz o que é apagado, anonimizado e guardado", () => {
    expect(DELETION_EFFECTS.apagado.join(" ")).toMatch(/login/)
    expect(DELETION_EFFECTS.anonimizado.join(" ")).toMatch(/sem seu nome, WhatsApp e e-mail/)
    expect(DELETION_EFFECTS.conservado.join(" ")).toMatch(/obrigação legal/)
  })
})
