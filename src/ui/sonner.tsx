import { toast as sonnerToast, Toaster } from "sonner"

export type ToastProps = {
  description?: string
  className?: string
}

export const toast = sonnerToast

export function useToast() {
  return { toast: sonnerToast }
}

export { Toaster }
