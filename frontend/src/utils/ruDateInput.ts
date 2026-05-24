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

/** VaDateInput с ISO-строкой в model-value отдаёт toISOString() — берём локальную календарную дату. */
export function pickerValueToIsoYmd(value: unknown): string {
  if (!value) return ''
  if (value instanceof Date) {
    return formatIsoDate(value)
  }
  if (typeof value === 'string') {
    const s = value.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    const parsed = new Date(s)
    if (!Number.isNaN(parsed.getTime())) return formatIsoDate(parsed)
  }
  return ''
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

/**
 * Календарная дата `YYYY-MM-DD` + **текущие** часы/минуты/секунды (момент отправки формы) в локальном
 * часовом поясе браузера → ISO UTC. Так в реестре видно реальное время оплаты, а не 00:00 или 03:00.
 */
/** Civil YYYY-MM-DD from stored @db.Date / ISO (UTC calendar, no local TZ shift). */
export function isoYmdFromUtcDateValue(value: Date): string {
  const y = value.getUTCFullYear()
  const m = String(value.getUTCMonth() + 1).padStart(2, '0')
  const d = String(value.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isoYmdFromDateField(value: string | Date | null | undefined): string | null {
  if (value == null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return isoYmdFromUtcDateValue(value)
  const s = String(value).trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function utcMsFromIsoYmd(isoYmd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoYmd.trim().slice(0, 10))
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function diffDaysInclusiveUtcYmd(startIso: string, endIso: string): number | null {
  const start = utcMsFromIsoYmd(startIso)
  const end = utcMsFromIsoYmd(endIso)
  if (start == null || end == null || end < start) return null
  return Math.floor((end - start) / 86400000) + 1
}

/** Add whole days on the UTC civil calendar (same as backend addUtcCalendarDays). */
export function addUtcCalendarDaysIsoYmd(isoYmd: string, daysToAdd: number): string {
  const start = utcMsFromIsoYmd(isoYmd)
  if (start == null) return ''
  const out = new Date(start)
  out.setUTCDate(out.getUTCDate() + daysToAdd)
  return isoYmdFromUtcDateValue(out)
}

export function addUtcCalendarDaysInclusiveEndIsoYmd(startIso: string, inclusiveDayCount: number): string {
  if (inclusiveDayCount < 1) return startIso.trim().slice(0, 10)
  return addUtcCalendarDaysIsoYmd(startIso, inclusiveDayCount - 1)
}

export function isoCalendarDateAtNowLocalTimeToUtcIso(isoYmd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoYmd.trim())
  const now = new Date()
  if (!m) return now.toISOString()
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return now.toISOString()
  return new Date(y, mo - 1, d, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()).toISOString()
}
