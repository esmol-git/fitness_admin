/**
 * Для <img src> допускаем только абсолютный http(s) или legacy data:image.
 * Относительные пути (ошибка конфига) дают запрос на origin SPA → 404 и «битую» картинку.
 */
export function clientPhotoDisplayUrl(raw: string | null | undefined): string {
  const u = typeof raw === 'string' ? raw.trim() : ''
  if (!u) return ''
  if (/^data:image\//i.test(u)) return u
  if (/^https?:\/\//i.test(u)) return u
  return ''
}

/** Значение для POST/PATCH: только http(s) public/presigned URL, не data: и не blob:. */
export function clientPhotoUrlForApiPayload(raw: string | null | undefined): string | undefined {
  const u = typeof raw === 'string' ? raw.trim() : ''
  if (!u) return undefined
  if (/^data:/i.test(u) || /^blob:/i.test(u)) return undefined
  if (/^https?:\/\//i.test(u)) return u
  return undefined
}
