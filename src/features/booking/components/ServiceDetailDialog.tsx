import { ArrowRight, Clock, Scissors } from "lucide-react"
import { ProfessionalPhoto } from "@/features/catalog/components/ProfessionalPhoto"
import { formatDuration, formatPrice } from "@/features/catalog/domain"
import { ImageCarousel } from "@/ui/carousel"
import { Button } from "@/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog"

export type ServiceDetail = { id: string; nome: string; descricao: string | null; preco_centavos: number; duracao_min: number }
export type DetailProfessional = { id: string; nome: string; avatar_path?: string | null }

/**
 * Pop-up de um serviço na página pública. Desktop: fotos à esquerda (sangram até a borda) e informações à direita.
 * Celular: foto em cima e informações embaixo.
 */
export function ServiceDetailDialog({ service, photos, professionals, onClose, onReserve }: {
  service: ServiceDetail | null
  photos: string[]
  professionals: DetailProfessional[]
  onClose: () => void
  onReserve: (serviceId: string) => void
}) {
  return (
    <Dialog open={Boolean(service)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[92dvh] w-[calc(100%-2rem)] max-w-[480px] gap-0 overflow-hidden bg-card p-0 md:grid md:max-w-[980px] md:grid-cols-[1.05fr_1fr] md:rounded-3xl"
      >
        {service && (
          <>
            <div className="animate-slide-left relative aspect-[4/3] bg-surface-alt md:aspect-auto md:min-h-[560px]">
              {photos.length > 0 ? (
                <ImageCarousel fill images={photos} alt={`Fotos de ${service.nome}`} className="absolute inset-0 h-full w-full" />
              ) : (
                <div data-testid="service-detail-fallback" aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/25 via-primary/10 to-surface-alt text-primary">
                  <Scissors className="size-20 opacity-80" />
                </div>
              )}
              <span className="pointer-events-none absolute bottom-4 left-4 inline-flex items-center gap-1.5 rounded-full bg-background/80 px-3 py-1.5 text-sm font-medium backdrop-blur-sm">
                <Clock className="size-4 text-primary" aria-hidden="true" />
                {formatDuration(service.duracao_min)}
              </span>
            </div>

            <div className="flex max-h-[92dvh] flex-col gap-5 overflow-y-auto p-6 md:p-10">
              <div className="animate-element animate-delay-100 flex flex-col gap-2 pr-8">
                <DialogTitle className="font-display text-3xl leading-tight font-bold tracking-wide md:text-4xl">{service.nome}</DialogTitle>
                <p className="font-display text-4xl font-semibold text-income tabular-nums">{formatPrice(service.preco_centavos)}</p>
              </div>

              <DialogDescription className="animate-element animate-delay-200 text-base leading-relaxed text-muted-foreground">
                {service.descricao?.trim() || "Sem descrição cadastrada. Fale com a barbearia se tiver dúvidas sobre este serviço."}
              </DialogDescription>

              <section aria-label="Quem atende" className="animate-element animate-delay-300 flex flex-col gap-2 border-t border-border pt-5">
                <h3 className="font-display text-lg font-semibold tracking-wide">Quem atende</h3>
                {professionals.length > 0 ? (
                  <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {professionals.map((p) => (
                      <li key={p.id} className="flex flex-col overflow-hidden rounded-card border border-border bg-background/40">
                        <ProfessionalPhoto nome={p.nome} path={p.avatar_path} className="aspect-square w-full rounded-none text-3xl" />
                        <p className="truncate px-2 py-2 text-center font-display text-sm font-semibold tracking-wide">{p.nome}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum profissional atende este serviço no momento.</p>
                )}
              </section>

              <div className="animate-element animate-delay-400 mt-auto flex flex-col gap-2 pt-2">
                <Button className="h-12 w-full gap-2 rounded-2xl text-base font-semibold" disabled={professionals.length === 0} onClick={() => onReserve(service.id)}>
                  Reservar {service.nome}
                  <ArrowRight className="size-5" aria-hidden="true" />
                </Button>
                <p className="text-center text-[13px] text-muted-foreground">No próximo passo você escolhe o profissional, o dia e o horário.</p>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
