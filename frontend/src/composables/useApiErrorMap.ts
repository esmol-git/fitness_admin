import axios from 'axios'
import i18n from '@/plugins/i18n'

interface ApiErrorMapOptions {
  defaultMessage: string
  byStatus?: Record<number, string>
  byCode?: Record<string, string>
}

function looksLikeRateLimitMessage(text: string) {
  const s = text.toLowerCase()
  return (
    s.includes('throttler') ||
    s.includes('too many requests') ||
    /\b429\b/.test(s)
  )
}

export function resolveApiErrorMessage(error: unknown, options: ApiErrorMapOptions): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const code = (() => {
      const data = error.response?.data as { code?: unknown; message?: unknown } | undefined
      if (typeof data?.code === 'string') return data.code
      const msg = data?.message
      if (msg != null && typeof msg === 'object' && !Array.isArray(msg) && 'code' in msg) {
        const c = (msg as { code?: unknown }).code
        return typeof c === 'string' ? c : null
      }
      return null
    })()
    if (code && options.byCode?.[code]) {
      return options.byCode[code]
    }
    if (status && options.byStatus?.[status]) {
      return options.byStatus[status]
    }
    if (status === 429) {
      return options.byStatus?.[429] ?? i18n.global.t('common.tooManyRequests')
    }
    const message = (() => {
      const data = error.response?.data as { message?: unknown } | undefined
      const m = data?.message
      if (typeof m === 'string') return m
      if (m != null && typeof m === 'object' && !Array.isArray(m) && 'message' in m) {
        const inner = (m as { message?: unknown }).message
        return typeof inner === 'string' ? inner : null
      }
      return null
    })()
    if (message) {
      if (looksLikeRateLimitMessage(message)) {
        return options.byStatus?.[429] ?? i18n.global.t('common.tooManyRequests')
      }
      return message
    }
  }
  return options.defaultMessage
}
