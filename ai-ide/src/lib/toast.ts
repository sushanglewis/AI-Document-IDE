import { toast } from 'sonner'

let lastId: string | number | undefined

export const Toast = {
  success(message: string, options?: any) {
    lastId = toast.success(message, options)
    return lastId
  },
  error(message: string, options?: any) {
    lastId = toast.error(message, options)
    return lastId
  },
  warning(message: string, options?: any) {
    lastId = toast.warning(message, options)
    return lastId
  },
  info(message: string, options?: any) {
    lastId = toast(message, options)
    return lastId
  },
  message(message: string, options?: any) {
    lastId = toast(message, options)
    return lastId
  },
  dismiss() {
    try { toast.dismiss() } catch { /* noop */ }
  }
}

export default Toast
