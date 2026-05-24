/** Номер шкафчика: только цифры, до 4 знаков (как при проходе в сканере). */
export const LOCKER_NUMBER_MAX_LEN = 4

export function sanitizeLockerDigits(value: unknown): string {
  return String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, LOCKER_NUMBER_MAX_LEN)
}

export function isLockerKeyAllowed(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return true
  const key = event.key
  if (key === 'Backspace' || key === 'Delete' || key === 'Tab' || key === 'Enter') return true
  if (key.startsWith('Arrow') || key === 'Home' || key === 'End') return true
  return /^\d$/.test(key)
}

export function onLockerDigitKeydown(event: KeyboardEvent) {
  if (!isLockerKeyAllowed(event)) event.preventDefault()
}
