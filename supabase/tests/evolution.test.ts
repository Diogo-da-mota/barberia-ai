/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Cliente e ciclo da instância Evolution (supabase/functions/_shared) contra um servidor Evolution simulado.
// Nada aqui chama um servidor real.
import { afterEach, describe, expect, it, vi } from "vitest"
import { evoSendText } from "../functions/_shared/evolution-client"
import { ensureInstanceAndGetQr, getInstanceStatus, instanceNameForBarbershop } from "../functions/_shared/evolution-instance"

const config = { url: "https://evo.test", apiKey: "chave-teste", webhookSecret: "segredo-webhook", webhookBaseUrl: "https://projeto.supabase.co" }
const LOJA = "ec09f33c-ced4-48bb-bff3-dbe5f807dbc3"
type Chamada = { metodo: string; caminho: string; corpo: any; apikey: string | null }

/** Servidor Evolution falso: responde por "MÉTODO caminho" e guarda cada chamada. */
function evolutionFalsa(rotas: Record<string, (corpo: any) => { status: number; body: unknown }>) {
  const chamadas: Chamada[] = []
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const u = new URL(url)
    const caminho = u.pathname + u.search
    const metodo = init.method ?? "GET"
    const corpo = init.body ? JSON.parse(String(init.body)) : null
    chamadas.push({ metodo, caminho, corpo, apikey: new Headers(init.headers).get("apikey") })
    const rota = rotas[`${metodo} ${caminho}`]
    const r = rota ? rota(corpo) : { status: 404, body: { message: "rota não simulada" } }
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } })
  })
  return chamadas
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Conectar WhatsApp: instância Evolution da barbearia", () => {
  const nome = instanceNameForBarbershop("Barbearia do TICO", LOJA)

  it("cria a instância, aponta o webhook e devolve o QR como data URL (sem prefixo duplicado)", async () => {
    const chamadas = evolutionFalsa({
      [`GET /instance/connectionState/${nome}`]: () => ({ status: 404, body: {} }),
      "POST /instance/create": () => ({ status: 201, body: {} }),
      [`POST /webhook/set/${nome}`]: () => ({ status: 201, body: {} }),
      [`GET /instance/fetchInstances?instanceName=${nome}`]: () => ({ status: 200, body: [{ name: nome, connectionStatus: "connecting" }] }),
      [`GET /instance/connect/${nome}`]: () => ({ status: 200, body: { base64: "data:image/png;base64,QUJD", pairingCode: "WZYX1234" } }),
    })
    const r = await ensureInstanceAndGetQr(config, LOJA, "Barbearia do TICO", null)
    expect(nome).toBe("barberia_barbearia_do_tico_ec09f33cced4")
    expect(r).toMatchObject({ instanceName: nome, connected: false, qr: { base64: "data:image/png;base64,QUJD", pairingCode: "WZYX1234" } })
    expect(chamadas.find((c) => c.caminho === "/instance/create")?.corpo).toMatchObject({ instanceName: nome, integration: "WHATSAPP-BAILEYS" })
    expect(chamadas.find((c) => c.caminho === `/webhook/set/${nome}`)?.corpo.webhook).toMatchObject({
      url: "https://projeto.supabase.co/functions/v1/evolution-webhook",
      headers: { "x-webhook-secret": "segredo-webhook" },
    })
    expect(chamadas.every((c) => c.apikey === "chave-teste")).toBe(true)
  })

  it("Evolution antiga (só o base64) também vira data URL", async () => {
    evolutionFalsa({
      [`GET /instance/connectionState/${nome}`]: () => ({ status: 200, body: { instance: { state: "close" } } }),
      [`POST /webhook/set/${nome}`]: () => ({ status: 201, body: {} }),
      [`GET /instance/fetchInstances?instanceName=${nome}`]: () => ({ status: 200, body: [{ name: nome, connectionStatus: "close" }] }),
      [`GET /instance/connect/${nome}`]: () => ({ status: 200, body: { base64: "QUJD" } }),
    })
    const r = await ensureInstanceAndGetQr(config, LOJA, "Barbearia do TICO", nome)
    expect(r.qr.base64).toBe("data:image/png;base64,QUJD")
  })

  it("depois da leitura do QR o estado é open: conectado, com o número pareado", async () => {
    evolutionFalsa({
      [`GET /instance/fetchInstances?instanceName=${nome}`]: () => ({
        status: 200,
        body: [{ name: nome, connectionStatus: "open", ownerJid: "5567992396649@s.whatsapp.net", profileName: "TICO" }],
      }),
    })
    expect(await getInstanceStatus(config, nome)).toEqual({ connected: true, state: "open", number: "5567992396649", profileName: "TICO" })
  })

  it("envia texto pela instância e devolve o id da mensagem", async () => {
    const chamadas = evolutionFalsa({
      [`POST /message/sendText/${nome}`]: () => ({ status: 201, body: { key: { id: "EVO-123" } } }),
    })
    const r = await evoSendText(config, nome, { number: "+55 (67) 99239-6649", text: "Olá" })
    expect(r.messageId).toBe("EVO-123")
    expect(chamadas[0].corpo).toEqual({ number: "5567992396649", text: "Olá" })
  })
})
