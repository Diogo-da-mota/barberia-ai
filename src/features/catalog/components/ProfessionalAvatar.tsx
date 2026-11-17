import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { publicMediaUrl } from "@/features/site/api"
import { validateImage } from "@/features/site/domain"
import { Cropper, type CropSpec } from "@/features/site/components/ImageCropDialog"
import { Button } from "@/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog"
import { toast } from "@/ui/sonner"
import { ProfessionalCard } from "./ProfessionalCard"
import { ProfessionalPhoto } from "./ProfessionalPhoto"
import { fetchProfessionals, removeProfessionalAvatar, uploadProfessionalAvatar } from "../api"

/** Recorte salvo da foto: 3:4, exatamente a coluna da foto no card da Equipe (`portrait`), então nada é cortado de novo. */
const PHOTO_SPEC: CropSpec = { label: "Foto", aspect: 3 / 4, width: 600, height: 800, ratio: "3:4", mime: "image/jpeg" }

/** Foto de perfil do profissional (aparece no pop-up de reserva do site). Ao escolher a imagem, abre o ajuste (arrastar e zoom) com a prévia no card; só o recorte confirmado é enviado. */
export function ProfessionalAvatar({ shopId, professionalId, nome }: { shopId: string; professionalId: string; nome: string }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<File | null>(null)
  const [live, setLive] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const team = useQuery({ queryKey: ["professionals", shopId], queryFn: () => fetchProfessionals(shopId) })
  const path = team.data?.status === "ok" ? team.data.data.find((p) => p.id === professionalId)?.avatar_path : null
  const url = publicMediaUrl(path)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["professionals", shopId] })

  const upload = useMutation({
    mutationFn: (file: File) => uploadProfessionalAvatar(shopId, professionalId, file),
    onSuccess: async () => { setError(null); await refresh(); toast.success("Foto de perfil salva.") },
    onError: () => setError("Não foi possível enviar a foto. Use JPEG, PNG ou WebP de até 2 MB."),
  })
  const remove = useMutation({
    mutationFn: () => removeProfessionalAvatar(professionalId),
    onSuccess: async () => { setError(null); await refresh(); toast.success("Foto removida.") },
    onError: () => setError("Não foi possível remover a foto. Tente novamente."),
  })
  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    const problem = validateImage(file)
    if (problem) { setError(problem); return }
    setSource(file)
  }
  // Clicar na foto atual reabre o ajuste com ela (mesmo caminho de Meu site: o CDN responde com CORS a pedidos sem cache)
  const adjustCurrent = async () => {
    if (!url) return
    setOpening(true)
    setError(null)
    try {
      const response = await fetch(url, { cache: "no-store" })
      if (!response.ok) throw new Error("fetch")
      const blob = await response.blob()
      setSource(new File([blob], "foto-atual", { type: blob.type || "image/jpeg" }))
    } catch {
      setError("Não foi possível abrir a foto atual para ajustar. Use Trocar foto para enviar de novo.")
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="flex min-h-28 min-w-0 flex-1 items-stretch overflow-hidden rounded-card border border-border bg-card">
      <div className="relative aspect-[3/4] w-28 shrink-0 self-stretch bg-surface-alt">
        {url ? (
          <button type="button" aria-label={`Ajustar foto de ${nome}`} title="Clique para ajustar a foto" disabled={opening || upload.isPending} onClick={() => void adjustCurrent()}
            className="absolute inset-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset">
            <ProfessionalPhoto nome={nome} path={path} className="h-full w-full rounded-none text-3xl" />
          </button>
        ) : (
          <ProfessionalPhoto nome={nome} path={path} className="absolute inset-0 h-full w-full rounded-none text-3xl" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 p-3">
        <p className="text-sm font-medium">Foto de perfil</p>
        {url && <p className="text-xs text-muted-foreground">{opening ? "Abrindo foto…" : "Clique na foto para reposicionar."}</p>}
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border px-3 text-sm font-medium md:min-h-10">
            {url ? "Trocar foto" : "Enviar foto"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pick} disabled={upload.isPending} />
          </label>
          {url && <Button type="button" variant="outline" className="h-11 md:h-10" disabled={remove.isPending} onClick={() => remove.mutate()}>Remover</Button>}
        </div>
        {upload.isPending && <p role="status" className="text-xs text-muted-foreground">Enviando foto…</p>}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
      <Dialog open={Boolean(source)} onOpenChange={(open) => !open && setSource(null)}>
        <DialogContent className="max-h-[92dvh] w-[calc(100%-2rem)] max-w-[720px] overflow-y-auto bg-card">
          <DialogTitle className="sr-only">Ajustar foto de {nome}</DialogTitle>
          <DialogDescription className="sr-only">Arraste a imagem, use o zoom e confira a prévia no card antes de aplicar.</DialogDescription>
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_240px] md:items-start">
            <div className="flex flex-col gap-4">
              {source && (
                <Cropper key={`${source.name}-${source.size}-${source.lastModified}`} file={source} kind="logo" spec={PHOTO_SPEC} inline onLive={setLive}
                  onCancel={() => setSource(null)} onConfirm={(cropped) => { setSource(null); upload.mutate(cropped) }} />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Como fica no card</p>
              <ProfessionalCard nome={nome} portrait photoFallback={live ? <img src={live} alt="" className="h-full w-full object-cover" /> : undefined} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
