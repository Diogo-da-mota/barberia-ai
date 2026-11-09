// @vitest-environment node
import { build } from "vite"
import type { Rollup } from "vite"
import { describe, expect, it } from "vitest"

// Regressão: sem o plugin do Tailwind v4, o build passa, mas o CSS sai sem
// nenhuma classe utilitária e a página aparece sem layout.
describe("CSS gerado pelo build", () => {
  it("contém as classes utilitárias usadas pelas telas", async () => {
    const result = (await build({
      logLevel: "silent",
      build: { write: false },
    })) as Rollup.RollupOutput

    const css = result.output
      .filter((file) => file.fileName.endsWith(".css"))
      .map((file) => (file.type === "asset" ? String(file.source) : ""))
      .join("")

    expect(css).not.toContain("@tailwind")
    // A unidade dvh exige número (h-dvh = 100dvh); sem ele o navegador ignora a altura.
    expect(css).not.toMatch(/height:\s*dvh/)
    for (const selector of [
      ".flex",
      ".items-center",
      ".bg-background",
      ".bg-primary",
      ".text-danger",
      ".bg-board",
      ".border-input",
      ".rounded-card",
    ]) {
      expect(css).toContain(selector)
    }
  }, 60_000)
})
