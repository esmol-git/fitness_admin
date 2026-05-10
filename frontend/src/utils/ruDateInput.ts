/** Shared RU date text helpers (dd.mm.yyyy ↔ ISO) for masked inputs and VaDatePicker. */

export function buildMonthNames(localeCode: string): string[] {
  const formatter = new Intl.DateTimeFormat(localeCode, { month: 'short' })
  return Array.from({ length: 12 }, (_, month) => {
    const label = formatter.format(new Date(Date.UTC(2024, month, 1)))
    return label.replace('.', '').trim()
  })
}

export function buildWeekdayNames(localeCode: string): string[] {
  const formatter = new Intl.DateTimeFormat(localeCode, { weekday: 'short' })
  const sunday = Date.UTC(2024, 0, 7)
  return Array.from({ length: 7 }, (_, offset) => {
    const label = formatter.format(new Date(sunday + offset * 24 * 60 * 60 * 1000))
    return label.replace('.', '').trim()
  })
}

export function formatIsoDate(value: unknown): string {
  if (!(value instanceof Date)) return ''
  if (Number.isNaN(value.getTime())) return ''
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function toDateValue(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [yy, mm, dd] = value.split('-').map((v) => Number(v))
  if (!yy || !mm || !dd) return undefined
  return new Date(yy, mm - 1, dd)
}

export function parseDateText(value: string): Date {
  const toStrictDate = (year: number, month: number, day: number) => {
    const date = new Date(year, month - 1, day)
    const isValid =
      date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    return isValid ? date : new Date(Number.NaN)
  }
  const normalized = value.trim()
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) return toStrictDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))
  const ruMatch = normalized.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (ruMatch) return toStrictDate(Number(ruMatch[3]), Number(ruMatch[2]), Number(ruMatch[1]))
  const compactRuMatch = normalized.match(/^(\d{2})(\d{2})(\d{4})$/)
  if (compactRuMatch) {
    return toStrictDate(Number(compactRuMatch[3]), Number(compactRuMatch[2]), Number(compactRuMatch[1]))
  }
  return new Date(Number.NaN)
}

export function toRuDateText(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  return `${match[3]}.${match[2]}.${match[1]}`
}

export function ruDateTextToIso(value: string): string {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!match) return ''
  const parsed = parseDateText(value)
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return ''
  return `${match[3]}-${match[2]}-${match[1]}`
}

export function normalizeDateInputText(raw: string): { text: string; iso: string; valid: boolean } {
  const normalized = raw.replace(/[^\d.]/g, '').slice(0, 10)
  if (!normalized) return { text: '', iso: '', valid: true }
  const iso = ruDateTextToIso(normalized)
  if (!iso) return { text: normalized, iso: '', valid: false }
  return { text: toRuDateText(iso), iso, valid: true }
}

export function hasDateFormatError(text: string): boolean {
  if (!text) return false
  if (text.length < 10) return false
  return !ruDateTextToIso(text)
}
