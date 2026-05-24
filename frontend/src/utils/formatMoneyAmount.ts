/** Сумма без хвостовых «.00»; дробная часть только если копейки не ноль. */
export function formatMoneyAmount(value: string | number | null | undefined): string {
  const n =
    typeof value === 'number'
      ? value
      : Number(String(value ?? '').trim().replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(n)) return '0'
  const rounded = Math.round(n * 100) / 100
  const whole = Math.trunc(rounded)
  const cents = Math.round((rounded - whole) * 100)
  if (cents === 0) return String(whole)
  const frac = String(cents).padStart(2, '0').replace(/0$/, '')
  return `${whole}.${frac}`
}
