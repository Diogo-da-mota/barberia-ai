import { useId, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Shell } from "@/app/Shell"
import { Button } from "@/ui/button"
import { Field, Panel } from "@/ui/finance"
import { Input } from "@/ui/input"
import { toast } from "@/ui/sonner"
import { createBarbershop } from "../api"
import { slugify, validateBarbershop } from "../domain"

const FIELD_CLASS = "h-11 text-base md:h-10 md:text-sm"

export function CreateBarbershop() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const ids = { nome: useId(), slug: useId() }
  const [nome, setNome] = useState("")
  const [slug, setSlug] = useState("")
  const [slugEdited, setSlugEdited] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const create = useMutation({
    mutationFn: () => createBarbershop(nome.trim(), slug),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["my-barbershops"] })
      toast.success("Barbearia criada.")
      navigate("/dashboard", { replace: true })
    },
    onError: (error: { code?: string; message?: string }) => {
      if (error?.code === "23505") setErrors({ slug: "Este endereço já está em uso. Escolha outro." })
      else if (error?.message?.includes("slug_not_reserved")) setErrors({ slug: "Este endereço é reservado pelo sistema. Escolha outro." })
      else if (error?.message === "shop_limit") setErrors({ form: "Cada proprietário pode ter até 3 barbearias." })
      else setErrors({ form: "Não foi possível criar a barbearia. Tente novamente." })
    },
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const found = validateBarbershop({ nome, slug })
    setErrors(found)
    if (Object.keys(found).length === 0) create.mutate()
  }

  return (
    <Shell>
      <div className="mx-auto flex w-full max-w-[768px] flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-bold tracking-wide sm:text-[28px]">Nova barbearia</h1>
          <p className="text-sm text-muted-foreground">Você será o proprietário e poderá convidar gerentes e barbeiros depois.</p>
        </header>

        <Panel className="max-w-[480px] p-4 sm:p-5">
          <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
            {errors.form && (
              <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {errors.form}
              </p>
            )}
            <Field label="Nome da barbearia" htmlFor={ids.nome} error={errors.nome} errorId={`${ids.nome}-erro`}>
              <Input
                id={ids.nome}
                value={nome}
                autoComplete="organization"
                aria-invalid={errors.nome ? true : undefined}
                aria-describedby={errors.nome ? `${ids.nome}-erro` : undefined}
                className={FIELD_CLASS}
                onChange={(event) => {
                  setNome(event.target.value)
                  if (!slugEdited) setSlug(slugify(event.target.value))
                }}
              />
            </Field>
            <Field label="Endereço público" htmlFor={ids.slug} error={errors.slug} errorId={`${ids.slug}-erro`}>
              <Input
                id={ids.slug}
                value={slug}
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={errors.slug ? true : undefined}
                aria-describedby={errors.slug ? `${ids.slug}-erro` : `${ids.slug}-dica`}
                className={FIELD_CLASS}
                onChange={(event) => {
                  setSlugEdited(true)
                  setSlug(event.target.value.toLowerCase())
                }}
              />
              <p id={`${ids.slug}-dica`} className="text-[13px] text-muted-foreground">
                Sua página ficará em {window.location.host}/{slug || "seu-endereco"}.
              </p>
            </Field>
            <Button type="submit" className="h-11 w-full md:h-10" disabled={create.isPending}>
              {create.isPending ? "Criando…" : "Criar barbearia"}
            </Button>
          </form>
        </Panel>
      </div>
    </Shell>
  )
}
