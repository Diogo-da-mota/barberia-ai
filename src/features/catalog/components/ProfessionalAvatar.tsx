import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { publicMediaUrl } from "@/features/site/api"
import { validateImage } from "@/features/site/domain"
import { Button } from "@/ui/button"
import { toast } from "@/ui/sonner"
import { ProfessionalPhoto } from "./ProfessionalPhoto"
import { fetchProfessionals, removeProfessionalAvatar, uploadProfessionalAvatar } from "../api"

/** Foto de perfil do profissional (aparece no pop-up de reserva do site). Envia na hora; sem AWS por enquanto. */
export function ProfessionalAvatar({ shopId, professionalId, nome }: { shopId: string; professionalId: string; nome: string }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
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
    upload.mutate(file)
  }

  return (
    <div className="flex min-h-28 min-w-0 flex-1 items-stretch overflow-hidden rounded-card border border-border bg-card">
      <div className="w-28 shrink-0 self-stretch bg-surface-alt"><ProfessionalPhoto nome={nome} path={path} className="aspect-square w-full rounded-none text-3xl" /></div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 p-3">
        <p className="text-sm font-medium">Foto de perfil</p>
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
    </div>
  )
}
