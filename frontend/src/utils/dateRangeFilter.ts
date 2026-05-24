import { pickerValueToIsoYmd, toDateValue } from '@/utils/ruDateInput'

export type DateRangeFilterMode = 'day' | 'range'

export function parseIsoDateLocal(value: string): Date | null {
  return toDateValue(value) ?? null
}

export function resolveInitialDateFilterMode(from: string, to: string): DateRangeFilterMode {
  if (from && from === to) return 'day'
  return 'range'
}

export function toRangePickerModel(from: string, to: string, pendingFrom = '') {
  const fromStr = pendingFrom || from || ''
  const toStr = to || ''
  const hasFrom = Boolean(fromStr)
  const hasTo = Boolean(toStr)
  if (!hasFrom && !hasTo) return undefined
  return {
    start: hasFrom ? parseIsoDateLocal(fromStr) ?? undefined : undefined,
    end: hasTo ? parseIsoDateLocal(toStr) ?? undefined : undefined,
  }
}

export type ParsedRangePickerValue =
  | { type: 'cleared' }
  | { type: 'pending'; from: string }
  | { type: 'commit'; from: string; to: string }

/** VaDateInput range: `{ start, end }`, массив или очистка. */
export function parseRangePickerValue(value: unknown, pendingFrom: string): ParsedRangePickerValue | null {
  if (value == null || value === '' || value === false) {
    return { type: 'cleared' }
  }

  const toIso = pickerValueToIsoYmd

  const parsePair = (a: unknown, b: unknown): ParsedRangePickerValue => {
    const from = a != null && a !== '' ? toIso(a) : ''
    const to = b != null && b !== '' ? toIso(b) : ''
    if (from && !to) {
      if (pendingFrom === from) return { type: 'commit', from, to: from }
      return { type: 'pending', from }
    }
    return { type: 'commit', from, to }
  }

  if (Array.isArray(value)) {
    const [a, b] = value
    return parsePair(a, b)
  }

  if (typeof value === 'object' && value !== null && ('start' in value || 'end' in value)) {
    const r = value as { start?: Date | string | null; end?: Date | string | null }
    return parsePair(r.start, r.end)
  }

  return null
}
