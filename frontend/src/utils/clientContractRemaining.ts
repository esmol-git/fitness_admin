export type ContractDaysTone = 'neutral' | 'green' | 'orange' | 'yellow' | 'red'

function parseIsoDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null
  const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null
  const dt = new Date(y, mo - 1, d)
  return Number.isNaN(dt.getTime()) ? null : dt
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * Дни до окончания договора и «тон» по доле оставшегося срока (от contractStart → contractEnd).
 * Пороги (доля оставшегося срока): ≥50% зелёный, 30–50% оранжевый, 10–30% жёлтый, меньше 10% красный;
 * нет дат / конец раньше начала — neutral; срок истёк — 0 дн., красный.
 * Один календарный день (start === end, типично «разовое») — не показываем прочерк: считаем период минимум 1 сутки для %.
 */
export function getClientContractDaysLeft(
  contractStartDate: string | null | undefined,
  contractEndDate: string | null | undefined,
): { daysLeft: number | null; pctRemaining: number | null; tone: ContractDaysTone } {
  const end = parseIsoDateOnly(contractEndDate ?? null)
  const start = parseIsoDateOnly(contractStartDate ?? null)
  if (!end) {
    return { daysLeft: null, pctRemaining: null, tone: 'neutral' }
  }

  const MS = 86400000
  const today = startOfLocalDay(new Date())
  const endDay = startOfLocalDay(end)
  const rawDaysLeft = Math.ceil((endDay.getTime() - today.getTime()) / MS)

  if (!start) {
    if (rawDaysLeft <= 0) return { daysLeft: 0, pctRemaining: null, tone: 'red' }
    return { daysLeft: rawDaysLeft, pctRemaining: null, tone: 'green' }
  }

  const startDay = startOfLocalDay(start)
  if (endDay.getTime() < startDay.getTime()) {
    return { daysLeft: null, pctRemaining: null, tone: 'neutral' }
  }

  const msLeft = endDay.getTime() - today.getTime()
  let msTotal = endDay.getTime() - startDay.getTime()
  if (msTotal < MS) {
    msTotal = MS
  }
  let pctRemaining = (msLeft / msTotal) * 100
  if (!Number.isFinite(pctRemaining)) pctRemaining = 0
  pctRemaining = Math.max(0, Math.min(100, pctRemaining))

  if (rawDaysLeft <= 0) {
    return { daysLeft: 0, pctRemaining: 0, tone: 'red' }
  }

  if (pctRemaining >= 50) {
    return { daysLeft: rawDaysLeft, pctRemaining, tone: 'green' }
  }
  if (pctRemaining >= 30) {
    return { daysLeft: rawDaysLeft, pctRemaining, tone: 'orange' }
  }
  if (pctRemaining >= 10) {
    return { daysLeft: rawDaysLeft, pctRemaining, tone: 'yellow' }
  }
  return { daysLeft: rawDaysLeft, pctRemaining, tone: 'red' }
}
