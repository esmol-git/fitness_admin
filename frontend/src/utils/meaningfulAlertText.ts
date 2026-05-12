/** Zero-width / BOM / soft hyphen — trim() их не убирает, из-за этого «пустой» алерт с рамкой. */
const INVISIBLE_OR_FORMAT = /[\u200B-\u200D\uFEFF\u00AD]/g

/** Текст для показа в баннере ошибки: без невидимых символов, без лишних пробелов по краям. */
export function meaningfulAlertText(value: string | null | undefined): string {
  if (value == null) return ''
  return String(value).replace(INVISIBLE_OR_FORMAT, '').trim()
}
