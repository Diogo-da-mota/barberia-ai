import { describe, expect, it } from "vitest"
import { servicePhotoPath } from "./domain"

describe("servicePhotoPath", () => {
  const shop = "00000000-0000-4000-8000-0000000000a1"
  const svc = "00000000-0000-4000-8000-0000000000b2"
  it("monta o caminho que o banco aceita: <loja>/servico-<serviço>-<id>.<ext>", () => {
    expect(servicePhotoPath(shop, svc, "image/png", "abc12")).toBe(`${shop}/servico-${svc}-abc12.png`)
    expect(servicePhotoPath(shop, svc, "image/jpeg", "x")).toBe(`${shop}/servico-${svc}-x.jpg`)
    expect(servicePhotoPath(shop, svc, "image/webp", "x")).toBe(`${shop}/servico-${svc}-x.webp`)
  })
})
