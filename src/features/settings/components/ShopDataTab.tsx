import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, FileText, Info, Loader2, Mail, MapPin, MessageCircle, Phone, Search, Store } from "lucide-react"
import { updateShopInfo } from "@/features/booking/api"
import type { MyBarbershop } from "@/features/home/domain"
import { saveSiteProfile } from "@/features/site/api"
import { isAccent } from "@/features/site/domain"
import { formatPhone, phoneDigits } from "@/lib/br"
import { formatDocumento } from "@/lib/br"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { Field } from "@/ui/finance"
import { Input } from "@/ui/input"
import { OptionSelect } from "@/ui/option-select"
import { PhoneInput } from "@/ui/phone-input"
import { toast } from "@/ui/sonner"
import { WhatsAppIcon } from "@/ui/whatsapp-icon"
import { lookupCep, saveShopFiscal, saveShopProfile, type Fiscal, type ShopDetails } from "../api"
import { DESCRICAO_MAX, UFS, cepDigits, composeAddress, formatCep, settingsErrorMessage, validateShopForm, type ShopForm, type TipoPessoa } from "../domain"
import { FIELD, PendingNotice, SettingsCard } from "@/ui/settings-card"
import { useWhatsAppConnection } from "../useWhatsAppConnection"
import { WhatsAppConnect } from "./WhatsAppConnect"

const TEXTAREA = "flex w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"

export function formFrom(details: ShopDetails, fiscal: Fiscal | null, shopEndereco: string | null): ShopForm {
  // sem as colunas novas, o endereço único antigo fica no campo "Endereço" (é o que o banco guarda até a migration 0012)
  const legacy = !details.supported
  return {
    nome: details.nome ?? "", nomeExibicao: details.nome_exibicao ?? "", razaoSocial: fiscal?.razao_social ?? "", descricao: details.descricao ?? "",
    telefone: details.telefone ? formatPhone(details.telefone) : "", whatsapp: details.whatsapp ? formatPhone(details.whatsapp) : "", email: details.email_comercial ?? "",
    cep: formatCep(details.cep ?? ""), logradouro: legacy ? (details.endereco ?? shopEndereco ?? "") : details.logradouro ?? (details.endereco ?? ""),
    numero: details.numero ?? "", complemento: details.complemento ?? "", bairro: details.bairro ?? "", cidade: details.cidade ?? "", uf: details.uf ?? "",
    tipoPessoa: fiscal?.tipo_pessoa ?? "juridica", documento: formatDocumento(fiscal?.documento ?? ""), inscricaoEstadual: fiscal?.inscricao_estadual ?? "",
  }
}

type Props = {
  shop: MyBarbershop
  details: ShopDetails
  fiscal: { supported: boolean; data: Fiscal | null }
  owner: boolean
  /** Cartão extra no fim da coluna da direita (o plano), para as duas colunas terminarem juntas. */
  extraRight?: ReactNode
}

export function ShopDataTab({ shop, details, fiscal, owner, extraRight }: Props) {
  const queryClient = useQueryClient()
  const initial = useMemo(() => formFrom(details, fiscal.data, shop.endereco), [details, fiscal.data, shop.endereco])
  const [form, setForm] = useState<ShopForm>(initial)
  // depois de salvar (ou se o banco trouxer outro valor), o formulário volta a refletir o que está gravado
  const initialKey = JSON.stringify(initial)
  useEffect(() => { setForm(initial) }, [initialKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [cepState, setCepState] = useState<"idle" | "loading" | "ok" | "fail">("idle")
  const numeroRef = useRef<HTMLInputElement>(null)

  const detailsOk = details.supported
  // o mesmo botão, QR e estado de Mais › WhatsApp e Mensagens › Notificações
  const whatsappConexao = useWhatsAppConnection(shop.id)
  const fiscalOk = fiscal.supported && owner
  const set = <K extends keyof ShopForm>(key: K, value: ShopForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)

  // busca de CEP: quando os 8 números estão digitados (ou ao clicar na lupa). Falhou: o usuário preenche à mão.
  const searchCep = async (digits: string) => {
    setCepState("loading")
    const found = await lookupCep(digits)
    if (!found) { setCepState("fail"); return }
    setForm((f) => ({ ...f, logradouro: found.logradouro || f.logradouro, bairro: found.bairro || f.bairro, cidade: found.cidade || f.cidade, uf: found.uf || f.uf }))
    setCepState("ok")
    numeroRef.current?.focus()
  }
  const onCep = (text: string) => {
    const masked = formatCep(text)
    set("cep", masked)
    setCepState("idle")
    if (cepDigits(masked).length === 8) void searchCep(cepDigits(masked))
  }

  const save = useMutation({
    mutationFn: async () => {
      if (detailsOk) {
        await saveShopProfile({
          shopId: shop.id, nome: form.nome, nomeExibicao: form.nomeExibicao, descricao: form.descricao, telefone: phoneDigits(form.telefone), whatsapp: phoneDigits(form.whatsapp), email: form.email,
          cep: cepDigits(form.cep), logradouro: form.logradouro, numero: form.numero, complemento: form.complemento, bairro: form.bairro, cidade: form.cidade, uf: form.uf,
        })
      } else {
        // banco sem a migration 0012: só o que já existe (nome, endereço único, telefone) e a descrição, pelo caminho do site
        const telefoneChanged = form.telefone !== initial.telefone
        await updateShopInfo(shop.id, { nome: form.nome.trim(), endereco: form.logradouro.trim() || null, ...(telefoneChanged && form.telefone.trim() ? { telefone: phoneDigits(form.telefone) } : {}) })
        if (form.descricao.trim() !== initial.descricao.trim()) {
          await saveSiteProfile({ shopId: shop.id, descricao: form.descricao, cor: isAccent(details.cor_destaque) ? details.cor_destaque : null, endereco: form.logradouro.trim(), telefone: phoneDigits(form.telefone) })
        }
      }
      const fiscalChanged = form.tipoPessoa !== initial.tipoPessoa || form.documento !== initial.documento || form.razaoSocial !== initial.razaoSocial || form.inscricaoEstadual !== initial.inscricaoEstadual
      if (fiscalOk && fiscalChanged) {
        await saveShopFiscal({ shopId: shop.id, tipo: form.tipoPessoa, documento: form.documento, razaoSocial: form.razaoSocial, responsavel: fiscal.data?.responsavel_nome ?? "", inscricaoEstadual: form.inscricaoEstadual })
      }
    },
    onSuccess: async () => {
      setFormError(null)
      await Promise.all(["shop-details", "shop-fiscal", "my-barbershops", "site-profile", "public-shop"].map((k) => queryClient.invalidateQueries({ queryKey: [k] })))
      toast.success("Dados salvos.")
    },
    onError: (e) => setFormError(settingsErrorMessage(e)),
  })

  const onSave = () => {
    const found = validateShopForm(form, { details: detailsOk, fiscal: fiscalOk })
    delete found.telefone // o telefone saiu da tela: o valor já salvo segue como está, sem erro invisível
    setErrors(found)
    if (Object.keys(found).length > 0) { setFormError("Corrija os campos destacados."); return }
    setFormError(null)
    save.mutate()
  }

  // o endereço que o site vai mostrar, montado das partes (mesma regra do servidor)
  const addressPreview = detailsOk ? composeAddress(form) : null
  useEffect(() => { if (!dirty) setErrors({}) }, [dirty])

  return (
    <div className="flex flex-col gap-4">
      {/* Duas colunas com a altura natural de cada card. Esquerda: Informações e Endereço.
          Direita: Contato comercial | Integração WhatsApp (mesma altura entre si), Dados fiscais e o plano logo abaixo. */}
      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <SettingsCard icon={Store} title="Informações da barbearia" hint="Dados principais que identificam o seu negócio.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome da barbearia" htmlFor="sd-nome" required error={errors.nome} errorId="sd-nome-erro">
                <Input id="sd-nome" value={form.nome} onChange={(e) => set("nome", e.target.value)} maxLength={120} aria-invalid={errors.nome ? true : undefined} aria-describedby={errors.nome ? "sd-nome-erro" : undefined} className={FIELD} />
              </Field>
              <Field label="Nome completo / Razão social" htmlFor="sd-razao">
                <Input id="sd-razao" value={form.razaoSocial} onChange={(e) => set("razaoSocial", e.target.value)} maxLength={160} disabled={!fiscalOk} className={FIELD} />
              </Field>
              <Field label="Nome de exibição no site" htmlFor="sd-exib">
                <Input id="sd-exib" value={form.nomeExibicao} onChange={(e) => set("nomeExibicao", e.target.value)} maxLength={120} disabled={!detailsOk} placeholder={form.nome} className={FIELD} />
                <p className="text-[13px] text-muted-foreground">Como o nome aparece na página pública. Em branco, vale o nome da barbearia.</p>
              </Field>
              <Field label="Descrição" htmlFor="sd-desc" error={errors.descricao} errorId="sd-desc-erro">
                <textarea id="sd-desc" value={form.descricao} onChange={(e) => set("descricao", e.target.value)} maxLength={DESCRICAO_MAX} rows={4} className={TEXTAREA} aria-describedby="sd-desc-conta" />
                <p id="sd-desc-conta" className="text-right text-[13px] text-muted-foreground">{form.descricao.length}/{DESCRICAO_MAX} · também aparece em Meu site</p>
              </Field>
            </div>
            {!owner && <p className="text-[13px] text-muted-foreground">Razão social e dados fiscais: só o proprietário vê e edita.</p>}
            {owner && !fiscal.supported && <PendingNotice>Razão social e dados fiscais dependem da migration 0012, ainda não aplicada.</PendingNotice>}
          </SettingsCard>

          <SettingsCard icon={MapPin} title="Endereço" hint="Localização da sua barbearia.">
            {!detailsOk && (
              <>
                <PendingNotice>O endereço em partes (CEP, número, bairro, cidade e estado) depende da migration 0012, ainda não aplicada. Por enquanto vale o endereço em uma linha.</PendingNotice>
                <Field label="Endereço (rua e bairro)" htmlFor="sd-end"><Input id="sd-end" value={form.logradouro} onChange={(e) => set("logradouro", e.target.value)} maxLength={200} className={FIELD} /></Field>
              </>
            )}
            {detailsOk && (
              <div className="grid gap-4 sm:grid-cols-6">
                <Field label="CEP" htmlFor="sd-cep" className="sm:col-span-2" error={errors.cep} errorId="sd-cep-erro">
                  <div className="relative">
                    <Input id="sd-cep" inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" value={form.cep} onChange={(e) => onCep(e.target.value)} aria-invalid={errors.cep ? true : undefined} className={cn(FIELD, "pr-11 tabular-nums")} />
                    <button type="button" aria-label="Buscar CEP" title="Buscar CEP" disabled={cepDigits(form.cep).length !== 8 || cepState === "loading"} onClick={() => void searchCep(cepDigits(form.cep))}
                      className="absolute top-0 right-0 grid h-11 w-11 place-items-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 md:h-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md">
                      {cepState === "loading" ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Search aria-hidden="true" className="h-4 w-4" />}
                    </button>
                  </div>
                  {cepState === "fail" && <p role="status" className="text-[13px] text-warning">Não encontramos este CEP agora. Preencha o endereço à mão.</p>}
                  {cepState === "ok" && <p role="status" className="text-[13px] text-income">Endereço preenchido. Confira e complete o número.</p>}
                </Field>
                <Field label="Endereço (rua, avenida, etc.)" htmlFor="sd-log" className="sm:col-span-4"><Input id="sd-log" value={form.logradouro} onChange={(e) => set("logradouro", e.target.value)} maxLength={120} autoComplete="address-line1" className={FIELD} /></Field>
                <Field label="Número" htmlFor="sd-num" className="sm:col-span-2"><Input id="sd-num" ref={numeroRef} value={form.numero} onChange={(e) => set("numero", e.target.value)} maxLength={20} className={FIELD} /></Field>
                <Field label="Complemento" htmlFor="sd-comp" className="sm:col-span-2"><Input id="sd-comp" value={form.complemento} onChange={(e) => set("complemento", e.target.value)} maxLength={80} placeholder="Sala, loja, prédio (opcional)" className={FIELD} /></Field>
                <Field label="Bairro" htmlFor="sd-bai" className="sm:col-span-2"><Input id="sd-bai" value={form.bairro} onChange={(e) => set("bairro", e.target.value)} maxLength={80} className={FIELD} /></Field>
                <Field label="Cidade" htmlFor="sd-cid" className="sm:col-span-4"><Input id="sd-cid" value={form.cidade} onChange={(e) => set("cidade", e.target.value)} maxLength={80} autoComplete="address-level2" className={FIELD} /></Field>
                <Field label="Estado" htmlFor="sd-uf" className="sm:col-span-2" error={errors.uf}><OptionSelect id="sd-uf" value={form.uf} onValueChange={(v) => set("uf", v)} options={UFS.map((u) => ({ value: u, label: u }))} placeholder="UF" /></Field>
                {addressPreview && <p className="text-[13px] text-muted-foreground sm:col-span-6">No site e nas mensagens: <span className="text-foreground">{addressPreview}</span></p>}
              </div>
            )}
          </SettingsCard>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <SettingsCard icon={Phone} title="Contato comercial" hint="Como os clientes falam com a barbearia.">
              <Field label="WhatsApp" htmlFor="sd-whats" error={errors.whatsapp} errorId="sd-whats-erro">
                <Adorned icon={<WhatsAppIcon className="h-5 w-5" />}>
                  <PhoneInput key={`whats-${initialKey}`} id="sd-whats" defaultValue={initial.whatsapp} onValueChange={(v) => set("whatsapp", v)} disabled={!detailsOk} className="pl-11" aria-invalid={errors.whatsapp ? true : undefined} />
                </Adorned>
              </Field>
              <Field label="E-mail comercial" htmlFor="sd-mail" error={errors.email} errorId="sd-mail-erro">
                <Adorned icon={<Mail aria-hidden="true" className="h-4 w-4 text-muted-foreground" />}>
                  <Input id="sd-mail" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} disabled={!detailsOk} maxLength={254} aria-invalid={errors.email ? true : undefined} className={cn(FIELD, "pl-11")} />
                </Adorned>
              </Field>
              {!detailsOk && <PendingNotice>WhatsApp e e-mail comerciais dependem da migration 0012, ainda não aplicada.</PendingNotice>}
            </SettingsCard>

            <SettingsCard icon={MessageCircle} title="Integração WhatsApp" hint="Canal que envia confirmações e lembretes.">
              <WhatsAppConnect connection={whatsappConexao} />
            </SettingsCard>
          </div>

          <SettingsCard icon={FileText} title="Dados fiscais" hint="Informações usadas em notas, contratos e repasses.">
            {!owner ? <p className="text-sm text-muted-foreground">Só o proprietário vê e edita os dados fiscais.</p> : (
              <>
                {!fiscal.supported && <PendingNotice>Os dados fiscais dependem da migration 0012, ainda não aplicada. Nada é salvo por enquanto.</PendingNotice>}
                <fieldset className="flex flex-col gap-2" disabled={!fiscalOk}>
                  <legend className="mb-1 text-sm font-medium">Tipo de pessoa</legend>
                  <div className="flex flex-wrap gap-x-6">
                    {([["fisica", "Pessoa Física"], ["juridica", "Pessoa Jurídica"]] as [TipoPessoa, string][]).map(([v, label]) => (
                      <label key={v} className="flex min-h-11 items-center gap-3 text-sm md:min-h-9"><input type="radio" name="tipo-pessoa" checked={form.tipoPessoa === v} onChange={() => { set("tipoPessoa", v); set("documento", "") }} className="h-5 w-5 accent-primary" />{label}</label>
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={form.tipoPessoa === "fisica" ? "CPF" : "CNPJ"} htmlFor="sd-doc" error={errors.documento} errorId="sd-doc-erro">
                    <Input id="sd-doc" inputMode="numeric" autoComplete="off" value={form.documento} disabled={!fiscalOk}
                      onChange={(e) => set("documento", formatDocumento(e.target.value).slice(0, form.tipoPessoa === "fisica" ? 14 : 18))}
                      placeholder={form.tipoPessoa === "fisica" ? "000.000.000-00" : "00.000.000/0000-00"} aria-invalid={errors.documento ? true : undefined} className={cn(FIELD, "tabular-nums")} />
                  </Field>
                  {form.tipoPessoa === "juridica" && (
                    <Field label="Inscrição estadual" htmlFor="sd-ie">
                      <Input id="sd-ie" value={form.inscricaoEstadual} disabled={!fiscalOk} maxLength={20} placeholder="Isento ou número (opcional)" onChange={(e) => set("inscricaoEstadual", e.target.value)} className={FIELD} />
                    </Field>
                  )}
                </div>
                <p className="text-[13px] text-muted-foreground">Dado pessoal protegido: só o proprietário acessa. Não aparece no site nem para a equipe.</p>
              </>
            )}
          </SettingsCard>
          {extraRight}
        </div>
      </div>


      <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3 text-sm text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <p>Essas informações são usadas no seu site, nos agendamentos e nas mensagens.</p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          {formError && <p role="alert" className="text-sm text-expense">{formError}</p>}
          <Button type="button" onClick={onSave} disabled={!dirty || save.isPending} className="h-11 w-full gap-2 sm:w-auto sm:min-w-52 md:h-10">
            <Check aria-hidden="true" className="h-4 w-4" />{save.isPending ? "Salvando…" : dirty ? "Salvar alterações" : "Tudo salvo"}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Ícone dentro do campo, à esquerda (o campo usa pl-11 para o texto não passar por baixo). */
function Adorned({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <div className="relative">{children}<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">{icon}</span></div>
}
