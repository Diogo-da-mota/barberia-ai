import { useId, useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog"
import { Field, MoneyInput } from "@/ui/finance"
import { Input } from "@/ui/input"
import { toast } from "@/ui/sonner"
import { saveService } from "../api"
import { ServicePhotos } from "./ServicePhotos"
import { catalogErrorMessage, validateService, type Service } from "../domain"

const FIELD_CLASS = "h-11 text-base md:h-10 md:text-sm"

type ServiceDialogProps = {
  shopId: string
  service: Service | null
  open: boolean
  onClose: () => void
}

export function ServiceDialog({ shopId, service, open, onClose }: ServiceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-[480px] overflow-y-auto bg-card">
        <div className="flex flex-col gap-1.5 pr-8 text-left">
          <DialogTitle className="font-display text-2xl font-bold tracking-wide">
            {service ? "Editar serviço" : "Novo serviço"}
          </DialogTitle>
          <DialogDescription>Preço e duração valem para novas reservas.</DialogDescription>
        </div>
        <ServiceForm key={service?.id ?? "novo"} shopId={shopId} service={service} onClose={onClose} />
      </DialogContent>
    </Dialog>
  )
}

function ServiceForm({ shopId, service, onClose }: Omit<ServiceDialogProps, "open">) {
  const queryClient = useQueryClient()
  const id = useId()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (value: Parameters<typeof saveService>[1]) => saveService(shopId, value, service?.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["services", shopId] })
      toast.success(service ? "Serviço atualizado." : "Serviço criado.")
      onClose()
    },
    onError: (error) => setServerError(catalogErrorMessage(error, "Já existe um serviço com este nome.")),
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const text = (name: string) => String(data.get(name) ?? "")
    const { errors: found, value } = validateService({
      nome: text("nome"),
      descricao: text("descricao"),
      preco: text("preco"),
      duracao: text("duracao"),
      ativo: data.get("ativo") === "on",
    })
    setErrors(found)
    setServerError(null)
    if (value) save.mutate(value)
  }

  const field = (name: string) => ({
    id: `${id}-${name}`,
    name,
    "aria-invalid": errors[name] ? (true as const) : undefined,
    "aria-describedby": errors[name] ? `${id}-${name}-erro` : undefined,
  })

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {serverError && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {serverError}
        </p>
      )}
      <Field label="Nome" htmlFor={`${id}-nome`} error={errors.nome} errorId={`${id}-nome-erro`}>
        <Input {...field("nome")} defaultValue={service?.nome} autoComplete="off" className={FIELD_CLASS} />
      </Field>
      <Field label="Descrição (opcional)" htmlFor={`${id}-descricao`} error={errors.descricao} errorId={`${id}-descricao-erro`}>
        <textarea
          {...field("descricao")}
          defaultValue={service?.descricao ?? ""}
          rows={2}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none md:text-sm"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Preço (R$)" htmlFor={`${id}-preco`} error={errors.preco} errorId={`${id}-preco-erro`}>
          <MoneyInput {...field("preco")} defaultCents={service?.preco_centavos ?? null} className={`${FIELD_CLASS} tabular-nums`} />
        </Field>
        <Field label="Duração (minutos)" htmlFor={`${id}-duracao`} error={errors.duracao} errorId={`${id}-duracao-erro`}>
          <Input {...field("duracao")} defaultValue={service?.duracao_min} inputMode="numeric" placeholder="40" className={`${FIELD_CLASS} tabular-nums`} />
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm md:min-h-8">
        <input type="checkbox" name="ativo" defaultChecked={service?.ativo ?? true} className="h-5 w-5 accent-primary" />
        Serviço ativo
      </label>
      {service ? (
        <ServicePhotos shopId={shopId} serviceId={service.id} />
      ) : (
        <p className="rounded-md bg-surface-alt px-3 py-2 text-sm text-muted-foreground">Salve o serviço para adicionar a foto.</p>
      )}
      <Button type="submit" className="h-11 w-full md:h-10" disabled={save.isPending}>
        {save.isPending ? "Salvando…" : "Salvar serviço"}
      </Button>
    </form>
  )
}
