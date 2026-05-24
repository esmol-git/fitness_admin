export const LOCKER_NUMBER_MAX_LEN = 4;

/** Только цифры, до 4 знаков — как при check-in в сканере. */
export function normalizeLockerNumber(value?: string | null): string | null {
  if (value == null) return null;
  const digits = value.replace(/\D/g, '').slice(0, LOCKER_NUMBER_MAX_LEN);
  return digits || null;
}
