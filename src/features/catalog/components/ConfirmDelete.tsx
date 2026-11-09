import { Button } from "@/ui/button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog"

type ConfirmDeleteProps = {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  pending: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDelete({ open, title, description, confirmLabel, cancelLabel = "Cancelar", pending, onConfirm, onClose }: ConfirmDeleteProps) {
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent className="w-[calc(100%-2rem)] max-w-[480px] bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="h-11 md:h-10" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" className="h-11 md:h-10" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
