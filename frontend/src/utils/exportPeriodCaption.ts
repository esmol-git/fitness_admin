import { detectQuickDatePreset, quickDatePresetRange, type QuickDatePreset } from '@/utils/dateRangePresets'

export function formatIsoDateForExport(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return iso
  return `${m[3]}.${m[2]}.${m[1]}`
}

type PeriodCaptionT = (key: string, values?: Record<string, unknown>) => string

function exportPeriodRangeCaption(fromIso: string, toIso: string, t: PeriodCaptionT): string {
  if (fromIso === toIso) {
    return t('common.exportPeriodForDay', { date: formatIsoDateForExport(fromIso) })
  }
  return t('common.exportPeriodRange', {
    from: formatIsoDateForExport(fromIso),
    to: formatIsoDateForExport(toIso),
  })
}

/** Подпись периода для шапки CSV/Excel: «за 12.12.2025», «за период: … — …» */
export function formatExportPeriodCaption(from: string, to: string, t: PeriodCaptionT): string | null {
  const fromIso = from.trim()
  const toIso = to.trim()
  if (!fromIso && !toIso) return null

  if (fromIso && toIso) {
    const preset = detectQuickDatePreset(fromIso, toIso)
    if (preset === 'today' || fromIso === toIso) {
      return t('common.exportPeriodForDay', { date: formatIsoDateForExport(fromIso) })
    }
    if (preset === '7d' || preset === '30d') {
      const range = quickDatePresetRange(preset as QuickDatePreset)
      return exportPeriodRangeCaption(range.from, range.to, t)
    }
    return exportPeriodRangeCaption(fromIso, toIso, t)
  }

  if (fromIso) {
    return t('common.exportPeriodForDay', { date: formatIsoDateForExport(fromIso) })
  }
  return t('common.exportPeriodForDay', { date: formatIsoDateForExport(toIso) })
}
