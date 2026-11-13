import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { phoneDigits, validatePhone } from "@/lib/br"
import { Button } from "@/ui/button"
import { Field, Panel } from "@/ui/finance"
import { PhoneInput } from "@/ui/phone-input"
import { toast } from "@/ui/sonner"
import { fetchMyWhatsapp, fillMyWhatsapp } from "../api"

/**
 * Conta sem WhatsApp (ex.: entrou com Google): pede o número uma vez. Ele é necessário para confirmar reservas e para
 * trazer à conta os agendamentos que a barbearia fez com o mesmo e-mail e WhatsApp. Some quando a conta já tem número
 * (nunca troca o que está salvo). Não diz se existe reserva: o vínculo só acontece depois, no banco.
 */
export function CompleteWhatsApp() {
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const profile = useQuery({ queryKey: ["my-whatsapp"], queryFn: fetchMyWhatsapp, enabled: Boolean(session) })
  const [whatsapp, setWhatsapp] = useState("")
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => fillMyWhatsapp(phoneDigits(whatsapp)),
    onSuccess: async () => {
      toast.success("WhatsApp salvo na sua conta.")
      await queryClient.invalidateQueries({ queryKey: ["my-whatsapp"] })
      await queryClient.invalidateQueries({ queryKey: ["my-bookings"] }) // busca de novo e traz as reservas que baterem
    },
    onError: () => setError("Não foi possível salvar. Confira o número com DDD."),
  })

  if (!session || !profile.isSuccess || profile.data) return null

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!whatsapp.trim() || !validatePhone(whatsapp)) return setError("Informe o WhatsApp com DDD, como +55 11 91234-5678.")
    setError(null)
    save.mutate()
  }

  return (
    <Panel className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold tracking-wide">Complete seu cadastro</h2>
        <p className="text-sm text-muted-foreground">
          Informe seu WhatsApp. Ele é usado para confirmar suas reservas e para encontrar agendamentos que a barbearia fez para você.
        </p>
      </div>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="WhatsApp" htmlFor="cw-whats" error={error ?? undefined} errorId="cw-whats-erro" className="flex-1">
          <PhoneInput id="cw-whats" defaultValue="" onValueChange={setWhatsapp} aria-invalid={error ? true : undefined} aria-describedby={error ? "cw-whats-erro" : undefined} />
        </Field>
        <Button type="submit" className="h-11 md:h-10" disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar"}</Button>
      </form>
    </Panel>
  )
}
