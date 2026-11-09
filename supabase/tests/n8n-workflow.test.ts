/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// n8n/barberia-fila-whatsapp.json: um único workflow importável, inativo, que a cada minuto dispara o outbox-worker
// no escopo de confirmações e lembretes. Nenhum segredo no arquivo: a autenticação é uma credencial Header Auth do n8n.
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const ARQUIVO = "n8n/barberia-fila-whatsapp.json"
const texto = readFileSync(ARQUIVO, "utf8")
const wf = JSON.parse(texto)
const no = (tipo: string) => wf.nodes.filter((n: any) => n.type === tipo)

describe("workflow n8n da fila do WhatsApp", () => {
  it("é importável e começa inativo", () => {
    expect(typeof wf.name).toBe("string")
    expect(Array.isArray(wf.nodes)).toBe(true)
    expect(wf.active).toBe(false)
    expect(new Set(wf.nodes.map((n: any) => n.name)).size).toBe(wf.nodes.length)
    for (const n of wf.nodes) expect(n, n.name).toMatchObject({ id: expect.any(String), type: expect.any(String), typeVersion: expect.any(Number), position: [expect.any(Number), expect.any(Number)] })
  })

  it("dispara a cada minuto", () => {
    const [gatilho] = no("n8n-nodes-base.scheduleTrigger")
    expect(gatilho.parameters.rule.interval).toEqual([{ field: "minutes", minutesInterval: 1 }])
  })

  it("chama o outbox-worker só no escopo de confirmações e lembretes, autenticado por credencial", () => {
    const [http] = no("n8n-nodes-base.httpRequest")
    expect(http.parameters).toMatchObject({
      method: "POST",
      url: expect.stringMatching(/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/outbox-worker$/),
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      specifyBody: "json",
    })
    expect(JSON.parse(http.parameters.jsonBody)).toEqual({ escopo: "confirmacoes_lembretes" })
    const [gatilho] = no("n8n-nodes-base.scheduleTrigger")
    expect(wf.connections[gatilho.name].main[0]).toEqual([{ node: http.name, type: "main", index: 0 }])
  })

  it("não guarda segredo nem lê variável de ambiente no workflow", () => {
    expect(texto).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/) // JWT (service_role/anon)
    expect(texto).not.toMatch(/sb_secret_|service_role|apikey/i)
    expect(texto).not.toMatch(/\$env\./)
    expect(JSON.stringify(wf.nodes.map((n: any) => n.parameters))).not.toMatch(/x-worker-secret"\s*:/)
  })
})
