import { ArrowLeftRight, Banknote, Barcode, CreditCard, QrCode, WalletCards } from "lucide-react"
import { OptionSelect } from "@/ui/option-select"
import { PAYMENT_FORMS, paymentFormLabel, type PaymentForm } from "../domain"

const ICONS = { pix: QrCode, dinheiro: Banknote, debito: CreditCard, credito: WalletCards, boleto: Barcode, transferencia: ArrowLeftRight } as const

/** Ícone da forma de pagamento: PIX, dinheiro, débito e crédito sempre com o mesmo desenho. */
export function PaymentFormIcon({ form, className = "h-4 w-4" }: { form: string; className?: string }) {
  const Icon = ICONS[form as keyof typeof ICONS] ?? WalletCards
  return <Icon className={className} aria-hidden="true" />
}

/** "Pix", "Crédito em 3x"… com o ícone ao lado. */
export function PaymentFormLabel({ form, parcelas = 1 }: { form: string; parcelas?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-primary"><PaymentFormIcon form={form} /></span>
      {paymentFormLabel(form)}{parcelas > 1 ? ` em ${parcelas}x` : ""}
    </span>
  )
}

export function PaymentFormSelect({ id, value, onChange }: { id?: string; value: PaymentForm; onChange: (value: PaymentForm) => void }) {
  return (
    <OptionSelect
      id={id} value={value} onValueChange={(v) => onChange(v as PaymentForm)}
      options={PAYMENT_FORMS.map((f) => ({ value: f.value, label: f.label, icon: <PaymentFormIcon form={f.value} className="h-4.5 w-4.5" /> }))}
    />
  )
}

export function InstallmentsSelect({ id, value, onChange }: { id?: string; value: string; onChange: (value: string) => void }) {
  return <OptionSelect id={id} value={value} onValueChange={onChange} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}x` }))} />
}
