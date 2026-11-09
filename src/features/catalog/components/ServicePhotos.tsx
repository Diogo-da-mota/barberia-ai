import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { X } from "lucide-react"
import { publicMediaUrl } from "@/features/site/api"
import { validateImage } from "@/features/site/domain"
import { toast } from "@/ui/sonner"
import { addServicePhoto, fetchServices, removeServicePhoto } from "../api"
import { MAX_SERVICE_PHOTOS } from "../domain"

/** Galeria do serviço no painel: até 5 fotos, enviadas na hora. É a mesma galeria que o cliente vê no card. */
export function ServicePhotos({ shopId, serviceId }: { shopId: string; serviceId: string }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  // lê o serviço atualizado da lista (o diálogo guarda uma cópia antiga)
  const services = useQuery({ queryKey: ["services", shopId], queryFn: () => fetchServices(shopId) })
  const galeria = services.data?.status === "ok" ? (services.data.data.find((s) => s.id === serviceId)?.galeria ?? []) : []
  const full = galeria.length >= MAX_SERVICE_PHOTOS
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["services", shopId] })

  const add = useMutation({
    mutationFn: (file: File) => addServicePhoto(shopId, serviceId, file),
    onSuccess: async () => { setError(null); await refresh(); toast.success("Foto adicionada.") },
    onError: (e) => setError((e as { message?: string })?.message === "photo_limit" ? "Cada serviço aceita até 5 fotos." : "Não foi possível enviar a foto. Use JPEG, PNG ou WebP de até 2 MB."),
  })
  const remove = useMutation({
    mutationFn: removeServicePhoto,
    onSuccess: async () => { setError(null); await refresh(); toast.success("Foto removida.") },
    onError: () => setError("Não foi possível remover a foto. Tente novamente."),
  })
  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    const problem = validateImage(file)
    if (problem) { setError(problem); return }
    add.mutate(file)
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Fotos do serviço</p>
        <p className="text-[13px] text-muted-foreground tabular-nums">{galeria.length}/{MAX_SERVICE_PHOTOS}</p>
      </div>
      {galeria.length > 0 && (
        <ul className="grid grid-cols-5 gap-2" aria-label="Fotos do serviço">
          {galeria.map((foto, index) => (
            <li key={foto.id} className="relative">
              <img src={publicMediaUrl(foto.path) ?? ""} alt={`Foto ${index + 1}`} className="aspect-square w-full rounded-md border border-border object-cover" />
              <button
                type="button" aria-label={`Remover foto ${index + 1}`} disabled={remove.isPending} onClick={() => remove.mutate(foto.id)}
                className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-background text-foreground shadow ring-1 ring-border hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className={`inline-flex min-h-11 w-fit items-center rounded-md border border-border px-3 text-sm font-medium md:min-h-10 ${full ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
        {full ? "Limite de 5 fotos" : "Adicionar foto"}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pick} disabled={full || add.isPending} />
      </label>
      {add.isPending && <p role="status" className="text-xs text-muted-foreground">Enviando foto…</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <p className="text-xs text-muted-foreground">JPEG, PNG ou WebP até 2 MB. No site, o cliente troca de foto pelas setas ou arrastando.</p>
    </div>
  )
}

