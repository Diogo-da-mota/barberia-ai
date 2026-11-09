import { useId, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Clock, UserPlus, UserRound } from "lucide-react"
import { Button } from "@/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs"
import { WorkingHoursEditor } from "@/features/booking/components/WorkingHours"
import { ProfessionalPhoto } from "./ProfessionalPhoto"
import { PhoneInput } from "@/ui/phone-input"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog"
import { Field } from "@/ui/finance"
import { Input } from "@/ui/input"
import { toast } from "@/ui/sonner"
import { formatDocumento, formatPhone, isEmail, phoneDigits, validateDocumento, validatePhone } from "@/lib/br"
import { linkProfessional, saveProfessional, saveProfessionalContact, type Barber, type ProfessionalContact } from "../api"
import { ProfessionalAvatar } from "./ProfessionalAvatar"
import { catalogErrorMessage, validateProfessional, type Professional, type Service } from "../domain"

type ProfessionalDialogProps = {
  shopId: string
  professional: Professional | null
  services: Service[]
  barbers: Barber[]
  linkedProfileId: string | null
  /** Contato atual (só a gestão recebe). */
  contact?: ProfessionalContact | null
  open: boolean
  onClose: () => void
}

export function ProfessionalDialog({ open, onClose, ...rest }: ProfessionalDialogProps) {
  const p = rest.professional
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-2rem)] max-w-[760px] gap-5 overflow-y-auto overflow-x-hidden bg-card p-0 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] md:rounded-3xl">
        <div className="flex items-center gap-4 border-b border-border bg-gradient-to-r from-primary/10 via-transparent to-transparent px-6 pt-6 pb-5 pr-14">
          {p ? (
            <ProfessionalPhoto nome={p.nome} path={p.avatar_path} className="h-16 w-16 rounded-2xl text-2xl" />
          ) : (
            <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 text-primary"><UserPlus className="h-7 w-7" /></span>
          )}
          <div className="flex min-w-0 flex-col gap-1 text-left">
            <DialogTitle className="truncate font-display text-2xl font-bold tracking-wide">{p ? p.nome : "Novo profissional"}</DialogTitle>
            <DialogDescription>{p ? "Dados, serviços e jornada semanal." : "Preencha os dados e marque os serviços que atende."}</DialogDescription>
          </div>
        </div>
        <Tabs defaultValue="dados" className="flex flex-col gap-4 px-6 pb-6">
          <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl">
            <TabsTrigger value="dados" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg"><UserRound className="h-4 w-4" aria-hidden="true" />Dados</TabsTrigger>
            <TabsTrigger value="horarios" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg"><Clock className="h-4 w-4" aria-hidden="true" />Horários</TabsTrigger>
          </TabsList>
          {/* forceMount: trocar de aba não perde o que foi digitado em "Dados" */}
          <TabsContent value="dados" forceMount className="mt-0 data-[state=inactive]:hidden">
            <ProfessionalForm key={rest.professional?.id ?? "novo"} onClose={onClose} {...rest} />
          </TabsContent>
          <TabsContent value="horarios" className="mt-0">
            {p ? <WorkingHoursEditor key={p.id} professionalId={p.id} /> : <p className="rounded-xl bg-surface-alt px-4 py-3 text-sm text-muted-foreground">Salve o profissional para definir os horários de atendimento dele.</p>}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function ProfessionalForm({ shopId, professional, services, barbers, linkedProfileId, contact, onClose }: Omit<ProfessionalDialogProps, "open">) {
  const queryClient = useQueryClient()
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [telefone, setTelefone] = useState(formatPhone(contact?.telefone ?? ""))
  const [documento, setDocumento] = useState(formatDocumento(contact?.documento ?? ""))
  const [contactErrors, setContactErrors] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: async (value: Parameters<typeof saveProfessional>[1] & { conta: string; contato: ProfessionalContact }) => {
      const { conta, contato, ...input } = value
      const id = await saveProfessional(shopId, input, professional?.id)
      await saveProfessionalContact(professional?.id ?? id, contato)
      // Só chama o vínculo quando a escolha mudou
      if (conta !== (linkedProfileId ?? "")) await linkProfessional(professional?.id ?? id, conta || null)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["professionals", shopId] })
      await queryClient.invalidateQueries({ queryKey: ["team-links", shopId] })
      await queryClient.invalidateQueries({ queryKey: ["professional-contacts", shopId] })
      toast.success(professional ? "Profissional atualizado." : "Profissional criado.")
      onClose()
    },
    onError: (e) => setServerError(catalogErrorMessage(e, "Já existe um profissional com este nome.")),
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const nome = String(data.get("nome") ?? "")
    const found = validateProfessional({ nome })
    const email = String(data.get("email") ?? "").trim()
    const erros: Record<string, string> = {}
    if (!validatePhone(telefone)) erros.telefone = "Telefone inválido. Use +55 00 00000-0000 ou 00 0000-0000."
    if (!isEmail(email)) erros.email = "E-mail inválido."
    if (!validateDocumento(documento)) erros.documento = "CPF ou CNPJ inválido."
    setContactErrors(erros)
    setError(found.nome ?? null)
    setServerError(null)
    if (!found.nome && Object.keys(erros).length === 0) {
      save.mutate({
        nome: nome.trim(),
        ativo: data.get("ativo") === "on",
        serviceIds: data.getAll("servicos").map(String),
        conta: String(data.get("conta") ?? linkedProfileId ?? ""),
        contato: { telefone: phoneDigits(telefone) || null, email: email || null, documento: documento.replace(/\D/g, "") || null },
      })
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {serverError && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {serverError}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" htmlFor={`${id}-nome`} error={error ?? undefined} errorId={`${id}-nome-erro`}>
        <Input
          id={`${id}-nome`}
          name="nome"
          defaultValue={professional?.nome}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-nome-erro` : undefined}
          className="h-11 text-base md:h-10 md:text-sm"
        />
      </Field>
        <Field label="Telefone" htmlFor={`${id}-telefone`} error={contactErrors.telefone} errorId={`${id}-telefone-erro`}>
          <PhoneInput id={`${id}-telefone`} name="telefone" defaultValue={contact?.telefone ?? ""} onValueChange={setTelefone}
            aria-invalid={contactErrors.telefone ? true : undefined} aria-describedby={contactErrors.telefone ? `${id}-telefone-erro` : undefined} />
        </Field>
        <Field label="E-mail" htmlFor={`${id}-email`} error={contactErrors.email} errorId={`${id}-email-erro`}>
          <Input id={`${id}-email`} name="email" type="email" autoComplete="off" placeholder="nome@exemplo.com" defaultValue={contact?.email ?? ""}
            aria-invalid={contactErrors.email ? true : undefined} aria-describedby={contactErrors.email ? `${id}-email-erro` : undefined} className="h-11 text-base md:h-10 md:text-sm" />
        </Field>
        <Field label="CPF ou CNPJ" htmlFor={`${id}-documento`} error={contactErrors.documento} errorId={`${id}-documento-erro`}>
          <Input id={`${id}-documento`} name="documento" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00 ou 00.000.000/0000-00" value={documento}
            aria-invalid={contactErrors.documento ? true : undefined} aria-describedby={contactErrors.documento ? `${id}-documento-erro` : undefined}
            onChange={(e) => setDocumento(formatDocumento(e.target.value))} className="h-11 text-base tabular-nums md:h-10 md:text-sm" />
        </Field>
      </div>
      <p className="-mt-2 text-[13px] text-muted-foreground">Telefone, e-mail e CPF ou CNPJ são visíveis só para a gestão. O +55 já vem no campo: digite o DDD e o número.</p>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Serviços que atende</legend>
        <div className="flex flex-wrap items-center gap-x-6">
          {services.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum serviço cadastrado ainda.{" "}
              <Link to="/dashboard/servicos" className="font-medium text-link underline-offset-4 hover:underline">
                Cadastrar serviços
              </Link>
            </p>
          ) : (
            services.map((service) => (
              <label key={service.id} className="flex min-h-11 items-center gap-3 text-sm md:min-h-8">
                <input
                  type="checkbox"
                  name="servicos"
                  value={service.id}
                  defaultChecked={professional?.service_ids.includes(service.id)}
                  className="h-5 w-5 accent-primary"
                />
                {service.nome}
              </label>
            ))
          )}
          <label className="flex min-h-11 items-center gap-3 text-sm md:min-h-8">
            <input type="checkbox" name="ativo" defaultChecked={professional?.ativo ?? true} className="h-5 w-5 accent-primary" />
            Profissional ativo
          </label>
        </div>
      </fieldset>

      {barbers.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">Conta de acesso do barbeiro</legend>
          <label className="flex min-h-11 items-center gap-3 text-sm md:min-h-8">
            <input type="radio" name="conta" value="" defaultChecked={!linkedProfileId} className="h-5 w-5 accent-primary" />
            Sem conta
          </label>
          {barbers.map((barber) => (
            <label key={barber.profile_id} className="flex min-h-11 items-center gap-3 text-sm md:min-h-8">
              <input type="radio" name="conta" value={barber.profile_id} defaultChecked={linkedProfileId === barber.profile_id} className="h-5 w-5 accent-primary" />
              {barber.nome}{barber.email ? ` (${barber.email})` : ""}
            </label>
          ))}
        </fieldset>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {professional ? (
        <ProfessionalAvatar shopId={shopId} professionalId={professional.id} nome={professional.nome} />
      ) : (
        <p className="rounded-md bg-surface-alt px-3 py-2 text-sm text-muted-foreground">Salve o profissional para adicionar a foto de perfil.</p>
      )}
      <Button type="submit" className="h-11 w-full shrink-0 sm:w-auto sm:px-8 md:h-10" disabled={save.isPending}>
        {save.isPending ? "Salvando…" : "Salvar profissional"}
      </Button>
      </div>
    </form>
  )
}
