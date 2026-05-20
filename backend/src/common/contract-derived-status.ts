import { utcCalendarDayMs, utcTodayCalendarDayMs } from './utc-calendar-day';

export const CONTRACT_DERIVED_STATUSES = ['SAVED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED'] as const;
export type ContractDerivedStatus = (typeof CONTRACT_DERIVED_STATUSES)[number];

/** Производный статус договора для UI, фильтров и Client.status (Europe/Moscow «сегодня»). */
export function deriveContractDerivedStatus(
  currentStatus: string,
  serviceStartDate?: Date | null,
  serviceEndDate?: Date | null,
): ContractDerivedStatus {
  if (currentStatus === 'DRAFT') return 'SAVED';
  if (currentStatus === 'CANCELLED') return 'CANCELLED';
  const today = utcTodayCalendarDayMs();
  if (currentStatus === 'EXPIRED') {
    const endExpired = serviceEndDate ? utcCalendarDayMs(new Date(serviceEndDate)) : null;
    if (endExpired !== null && endExpired >= today) return 'ACTIVE';
    return 'EXPIRED';
  }
  const start = serviceStartDate ? utcCalendarDayMs(new Date(serviceStartDate)) : null;
  const end = serviceEndDate ? utcCalendarDayMs(new Date(serviceEndDate)) : null;
  if (end !== null && end < today) return 'EXPIRED';
  if (currentStatus === 'PAUSED') return 'PAUSED';
  if (currentStatus === 'SIGNED') return 'ACTIVE';
  if (start === null) return 'SAVED';
  if (start > today) return 'SAVED';
  return 'ACTIVE';
}

export function isBlockingDerivedStatus(status: ContractDerivedStatus): boolean {
  return status === 'ACTIVE' || status === 'PAUSED';
}
