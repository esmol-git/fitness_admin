export type QuickDatePreset = 'today' | '7d' | '30d'

export function formatCalendarDayIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function calendarDayEnd(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export function quickDatePresetRange(preset: QuickDatePreset): { from: string; to: string } {
  const end = calendarDayEnd()
  if (preset === 'today') {
    const iso = formatCalendarDayIso(end)
    return { from: iso, to: iso }
  }
  const start = new Date(end)
  if (preset === '7d') start.setDate(end.getDate() - 6)
  if (preset === '30d') start.setDate(end.getDate() - 29)
  return { from: formatCalendarDayIso(start), to: formatCalendarDayIso(end) }
}

export function detectQuickDatePreset(from: string, to: string): QuickDatePreset | '' {
  if (!from || !to) return ''
  for (const preset of ['today', '7d', '30d'] as const) {
    const range = quickDatePresetRange(preset)
    if (range.from === from && range.to === to) return preset
  }
  return ''
}
