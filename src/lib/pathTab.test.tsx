/// <reference types="@testing-library/jest-dom/vitest" />
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase", () => ({ supabase: {}, authClients: {} }))

import { areaOf, isReservedSlug, PANEL_ROOTS } from "./shopPaths"
import { usePathTab } from "./pathTab"

const TABS = ["resumo", "pagamentos", "despesas"] as const
function Screen() {
  const [tab, setTab] = usePathTab("/financeiro", TABS, { repasses: "/financeiro/pagamentos" })
  const { pathname, search } = useLocation()
  return (
    <div>
      <p data-testid="aba">{tab}</p>
      <p data-testid="onde">{pathname}{search}</p>
      {TABS.map((t) => <button key={t} onClick={() => setTab(t)}>{t}</button>)}
    </div>
  )
}
const open = (path: string) => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/financeiro/:aba?" element={<Screen />} /></Routes></MemoryRouter>)
const state = () => [screen.getByTestId("aba").textContent, screen.getByTestId("onde").textContent]

describe("aba no caminho", () => {
  it("a raiz é a primeira aba e o segmento escolhe as outras; segmento desconhecido vale como a primeira", () => {
    open("/financeiro"); expect(state()).toEqual(["resumo", "/financeiro"]); document.body.innerHTML = ""
    open("/financeiro/despesas"); expect(state()).toEqual(["despesas", "/financeiro/despesas"]); document.body.innerHTML = ""
    open("/financeiro/inexistente"); expect(state()[0]).toBe("resumo")
  })

  it("trocar de aba muda o caminho, mantém os outros parâmetros e a primeira aba volta para a raiz", () => {
    open("/financeiro?mes=2026-12")
    fireEvent.click(screen.getByRole("button", { name: "despesas" }))
    expect(state()).toEqual(["despesas", "/financeiro/despesas?mes=2026-12"])
    fireEvent.click(screen.getByRole("button", { name: "resumo" }))
    expect(state()).toEqual(["resumo", "/financeiro?mes=2026-12"])
  })

  it("link antigo com ?aba= é convertido para o caminho; aba que mudou de lugar vai para o novo endereço", async () => {
    open("/financeiro?aba=despesas&mes=2026-12")
    await waitFor(() => expect(state()).toEqual(["despesas", "/financeiro/despesas?mes=2026-12"]))
    document.body.innerHTML = ""
    open("/financeiro?aba=repasses")
    await waitFor(() => expect(state()).toEqual(["pagamentos", "/financeiro/pagamentos"]))
  })
})

describe("telas do painel na raiz", () => {
  it("usam a sessão do painel e são palavras reservadas (nenhuma barbearia ocupa esses endereços)", () => {
    for (const root of PANEL_ROOTS) {
      expect(areaOf(`/${root}`), root).toBe("painel")
      expect(areaOf(`/${root}/aba?x=1`), root).toBe("painel")
      expect(isReservedSlug(root), root).toBe(true)
    }
    for (const path of ["/barbearia-do-tico", "/barbearia-do-tico/servicos", "/minhas-reservas", "/acesso", "/financeiro-do-ze", "/site-albuns"]) expect(areaOf(path), path).toBe("cliente")
  })
})
