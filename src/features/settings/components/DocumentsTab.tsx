import { useRef, useState, type DragEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Eye, FileText, Loader2, Trash2, UploadCloud } from "lucide-react"
import type { MyBarbershop } from "@/features/home/domain"
import { localDate } from "@/features/booking/domain"
import { cn } from "@/lib/utils"
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/ui/alert-dialog"
import { Button } from "@/ui/button"
import { EmptyState, Field } from "@/ui/finance"
import { OptionSelect } from "@/ui/option-select"
import { Skeleton } from "@/ui/skeleton"
import { toast } from "@/ui/sonner"
import { fetchDocuments, removeDocument, signedDocumentUrl, uploadDocument, type DocumentRow } from "../api"
import { DOCUMENT_TYPES, documentTypeLabel, formatBytes, settingsErrorMessage, validateDocumentFile, type DocumentType } from "../domain"
import { PendingNotice, SettingsCard } from "@/ui/settings-card"

const sentOn = (iso: string, tz: string) => localDate(iso, tz).split("-").reverse().join("/")

/** Documentos da barbearia em armazenamento PRIVADO (migration 0013): só o proprietário vê, envia e remove. Sem status de "válido": não há verificação. */
export function DocumentsTab({ shop, owner }: { shop: MyBarbershop; owner: boolean }) {
  const queryClient = useQueryClient()
  const tz = shop.fuso ?? "America/Sao_Paulo"
  const docs = useQuery({ queryKey: ["shop-documents", shop.id], queryFn: () => fetchDocuments(shop.id), enabled: owner })
  const [tipo, setTipo] = useState<DocumentType | "">("")
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [pending, setPending] = useState<{ file: File; tipo: DocumentType; replaces: DocumentRow } | null>(null)
  const [removing, setRemoving] = useState<DocumentRow | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const supported = docs.data?.supported ?? false
  const rows = docs.data?.rows ?? []
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["shop-documents", shop.id] })

  const upload = useMutation({
    mutationFn: ({ file, type }: { file: File; type: DocumentType }) => uploadDocument(shop.id, type, file),
    onSuccess: async () => { setError(null); await refresh(); toast.success("Documento enviado.") },
    onError: (e) => setError(settingsErrorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => removeDocument(id),
    onSuccess: async () => { await refresh(); toast.success("Documento removido.") },
    onError: (e) => toast.error(settingsErrorMessage(e)),
  })

  const choose = (file: File | undefined) => {
    if (!file) return
    if (!tipo) { setError("Escolha o tipo do documento antes de enviar o arquivo."); return }
    const problem = validateDocumentFile(file)
    if (problem) { setError(problem); return }
    setError(null)
    const existing = tipo === "outro" ? undefined : rows.find((r) => r.tipo === tipo)
    if (existing) { setPending({ file, tipo, replaces: existing }); return } // substituir pede confirmação
    upload.mutate({ file, type: tipo })
  }
  const onDrop = (event: DragEvent) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files?.[0]) }

  const view = async (row: DocumentRow) => {
    setOpening(row.id)
    const tab = window.open("", "_blank") // aberta já no clique, para o navegador não bloquear
    try {
      const url = await signedDocumentUrl(row.storage_path)
      if (tab) tab.location.href = url
      else window.location.assign(url)
    } catch {
      tab?.close()
      toast.error("Não foi possível abrir o documento. Tente novamente.")
    } finally { setOpening(null) }
  }

  if (!owner) {
    return <SettingsCard icon={FileText} title="Documentos da barbearia" hint="Armazene os principais documentos do seu negócio."><p className="text-sm text-muted-foreground">Só o proprietário acessa os documentos da barbearia.</p></SettingsCard>
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:items-start">
      <SettingsCard icon={FileText} title="Documentos da barbearia" hint="Armazene os principais documentos do seu negócio.">
        {docs.isError ? (
          <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm font-semibold">Não foi possível carregar os documentos</p>
            <Button variant="outline" className="h-11 md:h-10" onClick={() => void docs.refetch()}>Tentar novamente</Button>
          </div>
        ) : !docs.data ? <div role="status" aria-label="Carregando documentos"><Skeleton className="h-32 w-full" /></div> : !supported ? (
          <PendingNotice>O armazenamento seguro de documentos (bucket privado) depende da migration 0013, ainda não aplicada. Nenhum arquivo pode ser enviado por enquanto.</PendingNotice>
        ) : rows.length === 0 ? (
          <EmptyState title="Nenhum documento enviado" description="Envie ao lado o alvará, o comprovante de CNPJ e outros documentos do negócio." />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-surface-alt text-muted-foreground"><FileText className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold">{documentTypeLabel(d.tipo)}</p>
                  <p className="truncate text-sm text-muted-foreground">{d.nome_arquivo} · {formatBytes(d.tamanho_bytes)} · Enviado em {sentOn(d.criado_em, tz)}</p>
                </div>
                <Button variant="outline" size="icon" className="h-11 w-11 md:h-10 md:w-10" aria-label={`Ver ${documentTypeLabel(d.tipo)}`} title="Ver documento" disabled={opening === d.id} onClick={() => void view(d)}>
                  {opening === d.id ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="icon" className="h-11 w-11 md:h-10 md:w-10" aria-label={`Remover ${documentTypeLabel(d.tipo)}`} title="Remover documento" onClick={() => setRemoving(d)}><Trash2 aria-hidden="true" className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[13px] text-muted-foreground">Os arquivos ficam em armazenamento privado e só o proprietário os abre, por links que expiram em 1 minuto. Mantenha os documentos atualizados: podem ser pedidos em validações futuras.</p>
      </SettingsCard>

      <SettingsCard icon={UploadCloud} title="Adicionar documento" hint="Envie arquivos em PDF, JPG ou PNG, com até 10 MB.">
        <Field label="Tipo de documento" htmlFor="doc-tipo">
          <OptionSelect id="doc-tipo" value={tipo} onValueChange={(v) => { setTipo(v as DocumentType); setError(null) }} placeholder="Selecione o tipo" disabled={!supported}
            options={DOCUMENT_TYPES.map((t) => ({ value: t.value, label: t.hint ? `${t.label} (${t.hint})` : t.label }))} />
        </Field>
        <div
          onDragOver={(e) => { e.preventDefault(); if (supported) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={supported ? onDrop : undefined}
          className={cn("flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors", dragging ? "border-primary bg-primary/10" : "border-primary/50 bg-primary/[0.03]", !supported && "opacity-50")}
        >
          <UploadCloud aria-hidden="true" className="h-8 w-8 text-primary" />
          <p className="text-sm font-semibold">Arraste e solte o arquivo aqui</p>
          <Button type="button" variant="outline" className="h-11 md:h-10" disabled={!supported || upload.isPending} onClick={() => input.current?.click()}>{upload.isPending ? "Enviando…" : "Escolher arquivo"}</Button>
          <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" aria-label="Arquivo do documento" disabled={!supported || upload.isPending} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; choose(f) }} />
        </div>
        {upload.isPending && <p role="status" className="text-sm text-muted-foreground">Enviando documento…</p>}
        {error && <p role="alert" className="text-sm text-expense">{error}</p>}
      </SettingsCard>

      <AlertDialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir documento?</AlertDialogTitle>
            <AlertDialogDescription>{pending ? `${documentTypeLabel(pending.tipo)} já tem o arquivo “${pending.replaces.nome_arquivo}”. O novo arquivo “${pending.file.name}” vai substituí-lo e o antigo será apagado.` : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" className="h-11 md:h-10" onClick={() => setPending(null)}>Cancelar</Button>
            <Button className="h-11 md:h-10" onClick={() => { if (pending) upload.mutate({ file: pending.file, type: pending.tipo }); setPending(null) }}>Substituir</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover documento?</AlertDialogTitle>
            <AlertDialogDescription>{removing ? `“${removing.nome_arquivo}” (${documentTypeLabel(removing.tipo)}) será apagado do armazenamento. Isso não pode ser desfeito.` : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" className="h-11 md:h-10" onClick={() => setRemoving(null)}>Cancelar</Button>
            <Button className="h-11 md:h-10" onClick={() => { if (removing) remove.mutate(removing.id); setRemoving(null) }}>Remover</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
