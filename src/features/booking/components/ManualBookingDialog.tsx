import { useRef, useState, type FormEvent } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { fetchServices } from "@/features/catalog/api"
import { formatDuration, formatPrice, type Professional } from "@/features/catalog/domain"
import { phoneDigits } from "@/lib/br"
import { Button } from "@/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog"
import { Field } from "@/ui/finance"
import { Input } from "@/ui/input"
import { OptionSelect } from "@/ui/option-select"
import { PhoneInput } from "@/ui/phone-input"
import { toast } from "@/ui/sonner"
import { createManualBooking } from "../api"
import { bookingErrorMessage, validateContact, type Slot } from "../domain"
import { SlotPicker } from "./SlotPicker"

/**
 * "Novo agendamento" da gestão: cliente sem conta (só nome e WhatsApp). Horários vêm do mesmo get_availability da reserva
 * pública e o banco confere tudo de novo (permissão, jornada, bloqueios e conflito) em create_manual_booking.
 */
export function ManualBookingDialog({ open, shopId, tz, date, professionals, onClose, onDone }: {
  open: boolean; shopId: string; tz: string; date: string; professionals: Professional[]; onClose: () => void; onDone: () => Promise<unknown>
}) {
  const services = useQuery({ queryKey: ["services", shopId], queryFn: () => fetchServices(shopId), enabled: open })
  const ativos = services.data?.status === "ok" ? services.data.data.filter((s) => s.ativo) : []
  const [serviceId, setServiceId] = useState("")
  const [profId, setProfId] = useState("")
  const [slot, setSlot] = useState<Slot | null>(null)
  const [nome, setNome] = useState("")
  const [whatsapp, setWhatsapp] = useState("")
  const [email, setEmail] = useState("")
  const [lembretes, setLembretes] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const key = useRef(crypto.randomUUID())
  const novaTentativa = () => { key.current = crypto.randomUUID() }

  const equipe = professionals.filter((p) => p.ativo && (!serviceId || p.service_ids.includes(serviceId)))

  const reset = () => {
    setServiceId(""); setProfId(""); setSlot(null); setNome(""); setWhatsapp(""); setEmail(""); setLembretes(false); setErrors({}); novaTentativa()
  }
  const close = () => { reset(); onClose() }

  const save = useMutation({
    mutationFn: () => createManualBooking({
      shopId, serviceId, professionalId: profId, inicio: slot!.slot_inicio, nome: nome.trim(), whatsapp: phoneDigits(whatsapp), email, lembretes, key: key.current,
    }),
    onSuccess: async () => { await onDone(); toast.success("Agendamento criado."); close() },
    onError: (error) => { setErrors({ form: bookingErrorMessage(error) }); novaTentativa() },
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const found: Record<string, string> = { ...validateContact({ nome, whatsapp }) }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.email = "Confira o e-mail ou deixe em branco."
    if (!serviceId) found.servico = "Escolha o serviço."
    if (!profId) found.barbeiro = "Escolha o barbeiro."
    if (!slot) found.horario = "Escolha o dia e o horário."
    setErrors(found)
    if (Object.keys(found).length === 0) save.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-[560px] overflow-y-auto bg-card">
        <div className="flex flex-col gap-1.5 pr-8 text-left">
          <DialogTitle className="font-display text-2xl font-bold tracking-wide">Novo agendamento</DialogTitle>
          <DialogDescription>Para clientes sem cadastro: basta nome e WhatsApp. A reserva entra na agenda do barbeiro escolhido.</DialogDescription>
        </div>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
          {errors.form && <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{errors.form}</p>}
          <Field label="Nome do cliente" htmlFor="ma-nome" error={errors.nome} errorId="ma-nome-erro">
            <Input id="ma-nome" value={nome} maxLength={120} autoComplete="off" onChange={(e) => setNome(e.target.value)} aria-invalid={errors.nome ? true : undefined} aria-describedby={errors.nome ? "ma-nome-erro" : undefined} className="h-11 text-base md:h-10 md:text-sm" />
          </Field>
          <Field label="WhatsApp" htmlFor="ma-whats" error={errors.whatsapp} errorId="ma-whats-erro">
            <PhoneInput key={open ? "aberto" : "fechado"} id="ma-whats" defaultValue={whatsapp} onValueChange={setWhatsapp} aria-invalid={errors.whatsapp ? true : undefined} aria-describedby={errors.whatsapp ? "ma-whats-erro" : undefined} />
          </Field>
          <Field label="E-mail (opcional)" htmlFor="ma-email" error={errors.email} errorId="ma-email-erro">
            <Input id="ma-email" type="email" value={email} maxLength={254} autoComplete="off" onChange={(e) => setEmail(e.target.value)} aria-invalid={errors.email ? true : undefined} aria-describedby={errors.email ? "ma-email-erro" : "ma-email-dica"} className="h-11 text-base md:h-10 md:text-sm" />
            {!errors.email && <p id="ma-email-dica" className="text-xs text-muted-foreground">Quando o cliente criar a conta com este e-mail e este WhatsApp, a reserva aparece em "Minhas reservas" dele.</p>}
          </Field>
          <Field label="Serviço" htmlFor="ma-servico" error={errors.servico} errorId="ma-servico-erro">
            <OptionSelect id="ma-servico" value={serviceId} placeholder={services.isPending ? "Carregando…" : "Escolha o serviço"}
              options={ativos.map((s) => ({ value: s.id, label: `${s.nome} · ${formatDuration(s.duracao_min)} · ${formatPrice(s.preco_centavos)}` }))}
              onValueChange={(v) => { setServiceId(v); if (!professionals.find((p) => p.id === profId)?.service_ids.includes(v)) setProfId(""); setSlot(null); novaTentativa() }} />
          </Field>
          <Field label="Barbeiro" htmlFor="ma-barbeiro" error={errors.barbeiro} errorId="ma-barbeiro-erro">
            <OptionSelect id="ma-barbeiro" value={profId} placeholder="Escolha o barbeiro" disabled={!serviceId}
              options={equipe.map((p) => ({ value: p.id, label: p.nome }))}
              onValueChange={(v) => { setProfId(v); setSlot(null); novaTentativa() }} />
          </Field>
          {serviceId && profId && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Dia e horário</legend>
              <SlotPicker shopId={shopId} tz={tz} serviceId={serviceId} professionalId={profId} initialDate={date}
                selected={slot?.slot_inicio ?? null} onSelect={(s) => { setSlot(s); novaTentativa() }} />
              {errors.horario && <p className="text-sm text-danger">{errors.horario}</p>}
            </fieldset>
          )}
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={lembretes} onChange={(e) => setLembretes(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-primary" />
            O cliente aceita receber a confirmação e os lembretes no WhatsApp.
          </label>
          <Button type="submit" className="h-11 w-full md:h-10" disabled={save.isPending}>{save.isPending ? "Agendando…" : "Confirmar agendamento"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
