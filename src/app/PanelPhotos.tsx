/**
 * Fotos do painel com os degradês que as fundem ao fundo. São os MESMOS componentes no painel (Shell) e na prévia de
 * Meu site › Fotos: o que aparece na prévia é o que aparece no painel. `src`: undefined = ainda carregando (só os degradês, sem
 * piscar a foto padrão), null = foto padrão, texto = foto da barbearia.
 */

/** Foto do menu lateral (abaixo de "Mais"). O contêiner (altura e posição) fica em quem usa. */
export function SidebarPhoto({ src }: { src: string | null | undefined }) {
  return (
    <>
      {src !== undefined && <img src={src ?? "/images/painel-menu.jpg"} alt="" loading="lazy" className="h-full w-full object-cover object-center opacity-80" />}
      <div className="absolute inset-0 bg-gradient-to-b from-card via-card/70 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
      <div className="absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-card/80 to-transparent" />
    </>
  )
}

/** Foto de fundo do topo do Início (/dashboard): 440 px de altura na largura da área principal, atrás do cabeçalho e da saudação. */
export function HeroPhoto({ src }: { src: string | null | undefined }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[440px] overflow-hidden">
      {src !== undefined && <img src={src ?? "/images/painel-topo.jpg"} alt="" className="h-full w-full object-cover object-[center_40%] opacity-60" />}
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-transparent to-background" />
    </div>
  )
}
