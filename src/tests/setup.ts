import "@testing-library/jest-dom"

// O jsdom não tem matchMedia (o carrossel do embla usa para as opções responsivas). No navegador existe.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList
}

// Observadores que o carrossel (embla) usa e o jsdom não tem.
if (typeof window !== "undefined") {
  const w = window as unknown as Record<string, unknown>
  if (!("IntersectionObserver" in window)) {
    w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } } as unknown as typeof IntersectionObserver
  }
  if (!("ResizeObserver" in window)) {
    w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  }
}

// Radix Select/Popover usam APIs de ponteiro e rolagem que o jsdom não implementa.
if (typeof window !== "undefined") {
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => {}
  proto.releasePointerCapture ??= () => {}
  proto.scrollIntoView ??= () => {}
}
