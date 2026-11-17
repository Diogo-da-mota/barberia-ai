import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy } from "lucide-react"
import { createInvite, fetchInvites, renewInvite } from "@/features/booking/api"
import { bookingErrorMessage, formatDateTime } from "@/features/booking/domain"
import type { MyBarbershop } from "@/features/home/domain"
import { Button } from "@/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog"
import { Field, Panel } from "@/ui/finance"
import { Input } from "@/ui/input"
import { toast } from "@/ui/sonner"

const FIELD = "h-11 text-base md:h-10 md:text-sm"

/** Pop-up para convidar alguém para a equipe (barbeiro ou gerente): gera o link e lista os convites enviados. O gerente só convida barbeiros. */
export function InviteDialog({ shop, open, onOpenChange }: { shop: MyBarbershop; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isOwner = shop.papel === "proprietario"

  const invite = useMutation({
    mutationFn: (v: { email: string; papel: "gerente" | "barbeiro" }) => createInvite(shop.id, v.email, v.papel),
    onSuccess: async (token) => {
      setLink(`${window.location.origin}/convite?token=${token}`)
      await queryClient.invalidateQueries({ queryKey: ["invites", shop.id] })
    },
    onError: (e) => setError(bookingErrorMessage(e)),
  })
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const email = String(data.get("email") ?? "").trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("Informe um email válido."); return }
    setError(null); setLink(null)
    invite.mutate({ email, papel: String(data.get("papel")) as "gerente" | "barbeiro" })
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(link ?? ""); toast.success("Link copiado.") } catch { toast.error("Não foi possível copiar. Selecione o link e copie.") }
  }
  const close = (next: boolean) => { if (!next) { setLink(null); setError(null) } onOpenChange(next) }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-2rem)] max-w-[480px] overflow-y-auto bg-card">
        <div className="flex flex-col gap-1 pr-8 text-left">
          <DialogTitle className="font-display text-2xl font-bold tracking-wide">Convidar para a equipe</DialogTitle>
          <DialogDescription>Gere um link para o barbeiro ou gerente entrar na sua barbearia.</DialogDescription>
        </div>

        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <Field label="Email da pessoa" htmlFor="iv-email"><Input id="iv-email" name="email" type="email" autoComplete="off" className={FIELD} /></Field>
          <fieldset className="flex flex-wrap items-center gap-x-6">
            <legend className="mb-1 text-sm font-medium">Papel</legend>
            <label className="flex min-h-11 items-center gap-3 text-sm md:min-h-9"><input type="radio" name="papel" value="barbeiro" defaultChecked className="h-5 w-5 accent-primary" />Barbeiro</label>
            {isOwner && <label className="flex min-h-11 items-center gap-3 text-sm md:min-h-9"><input type="radio" name="papel" value="gerente" className="h-5 w-5 accent-primary" />Gerente</label>}
          </fieldset>
          <Button type="submit" className="h-11 w-full md:h-10" disabled={invite.isPending}>{invite.isPending ? "Gerando…" : "Gerar link do convite"}</Button>
        </form>

        {link && (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-alt p-3">
            <p className="text-sm font-medium">Envie este link para a pessoa. Ele aparece só agora e vale por 7 dias.</p>
            <div className="flex gap-2">
              <Input readOnly aria-label="Link do convite" value={link} className={FIELD} onFocus={(e) => e.currentTarget.select()} />
              <Button variant="outline" className="h-11 shrink-0 gap-2 md:h-10" onClick={copy}><Copy aria-hidden="true" className="h-4 w-4" />Copiar link</Button>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  )
}

/** Histórico dos convites (fica abaixo dos cards da Equipe, fora do pop-up). Some quando não há convites. */
export function InviteHistory({ shop }: { shop: MyBarbershop }) {
  const queryClient = useQueryClient()
  const invites = useQuery({ queryKey: ["invites", shop.id], queryFn: () => fetchInvites(shop.id) })
  const [manual, setManual] = useState<{ id: string; link: string } | null>(null)
  // o link antigo não pode ser lido (só o hash fica no banco): renova no mesmo convite, copia e o anterior deixa de valer
  const renew = useMutation({
    mutationFn: async (id: string) => ({ id, link: `${window.location.origin}/convite?token=${await renewInvite(id)}` }),
    onSuccess: async ({ id, link }) => {
      await queryClient.invalidateQueries({ queryKey: ["invites", shop.id] })
      try {
        await navigator.clipboard.writeText(link)
        setManual(null)
        toast.success("Link copiado!", { description: "O link anterior deste convite deixou de valer." })
      } catch {
        setManual({ id, link }) // sem acesso à área de transferência: mostra o link para copiar à mão
      }
    },
    onError: (e) => toast.error(bookingErrorMessage(e)),
  })
  if (!invites.data?.length) return null
  return (
    <Panel className="flex flex-col gap-1 p-4">
      <h3 className="text-sm font-medium">Histórico de convites</h3>
      <ul className="divide-y divide-border text-sm" aria-label="Histórico de convites">
        {invites.data.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-x-3 py-1.5">
            <span className="min-w-0 truncate">{i.email} · {i.papel === "gerente" ? "Gerente" : "Barbeiro"}</span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {i.aceito_em ? "Aceito" : new Date(i.expires_at) < new Date() ? "Expirado" : `Válido até ${formatDateTime(i.expires_at, shop.fuso ?? "America/Sao_Paulo")}`}
              {/* só pendente e válido; convite de gerente só o proprietário renova */}
              {!i.aceito_em && new Date(i.expires_at) > new Date() && (i.papel === "barbeiro" || shop.papel === "proprietario") && (
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={renew.isPending} onClick={() => renew.mutate(i.id)}
                  aria-label={`Copiar link do convite de ${i.email}`} title="Copiar link (gera um novo; o anterior deixa de valer)">
                  <Copy aria-hidden="true" className="h-4 w-4" />
                </Button>
              )}
            </span>
            {manual?.id === i.id && <Input readOnly aria-label="Link do convite" value={manual.link} className={`${FIELD} mt-1 w-full`} onFocus={(e) => e.currentTarget.select()} />}
          </li>
        ))}
      </ul>
    </Panel>
  )
}
