/**
 * Comparable calendar-day ordinals for contract logic.
 * - Stored dates: PostgreSQL @db.Date → JS Date at UTC midnight; use UTC Y/M/D as the civil date.
 * - "Today": club calendar in Europe/Moscow (same as nightly cron in contracts.service).
 */
const CONTRACT_CALENDAR_TIMEZONE = 'Europe/Moscow';

export function utcCalendarDayMs(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Start of "today" on the club calendar — must match how we compare serviceEndDate (civil dates). */
export function utcTodayCalendarDayMs(): number {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: CONTRACT_CALENDAR_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** UTC midnight Date for club "today". */
export function utcTodayStartDate(): Date {
  return new Date(utcTodayCalendarDayMs());
}

/** Parse YYYY-MM-DD (or ISO datetime prefix) as UTC calendar date. */
export function utcDateFromIsoYmd(value?: string | null): Date | null {
  if (!value?.trim()) return null;
  const iso = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/** Format stored @db.Date as YYYY-MM-DD using UTC civil calendar (no local TZ shift). */
export function isoYmdFromUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function diffDaysInclusiveUtc(startDate: Date, endDate: Date): number {
  const start = utcCalendarDayMs(startDate);
  const end = utcCalendarDayMs(endDate);
  return Math.floor((end - start) / 86400000) + 1;
}

/**
 * Фактические дни заморозки при досрочной разморозке.
 * Заморозка и разморозка в один календарный день = 0 (отмена в день оформления).
 */
export function actualFreezeDaysOnResumeUtc(freezeStart: Date, resumeAt: Date): number {
  if (utcCalendarDayMs(freezeStart) === utcCalendarDayMs(resumeAt)) return 0;
  return diffDaysInclusiveUtc(freezeStart, resumeAt);
}

/** UTC midnight for the civil calendar day of `d` (ignores time-of-day / local TZ). */
export function utcCalendarDateFromDate(d: Date): Date {
  return new Date(utcCalendarDayMs(d));
}

/** Add whole calendar days on the UTC civil calendar. */
export function addUtcCalendarDays(d: Date, daysToAdd: number): Date {
  const out = utcCalendarDateFromDate(d);
  out.setUTCDate(out.getUTCDate() + daysToAdd);
  return out;
}

/** Inclusive end date for a span of `inclusiveDayCount` days starting at `start`. */
export function addUtcCalendarDaysInclusiveEnd(start: Date, inclusiveDayCount: number): Date {
  if (inclusiveDayCount < 1) return utcCalendarDateFromDate(start);
  return addUtcCalendarDays(start, inclusiveDayCount - 1);
}

export function maxUtcCalendarDate(a: Date, b: Date): Date {
  const am = utcCalendarDayMs(a);
  const bm = utcCalendarDayMs(b);
  return new Date(am >= bm ? am : bm);
}

/** End of service period from catalog duration (UTC calendar arithmetic). */
export function addCalendarDurationUtc(
  serviceStartDate: Date,
  durationValue: number | null | undefined,
  durationUnit: string | null | undefined,
): Date | null {
  if (durationValue == null || !durationUnit) return null;
  const startMs = utcCalendarDayMs(serviceStartDate);
  const start = new Date(startMs);
  const end = new Date(startMs);
  if (durationUnit === 'DAY') {
    end.setUTCDate(end.getUTCDate() + durationValue);
  } else if (durationUnit === 'WEEK') {
    end.setUTCDate(end.getUTCDate() + durationValue * 7);
  } else if (durationUnit === 'MONTH') {
    const anchorDay = start.getUTCDate();
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + durationValue);
    const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
    end.setUTCDate(Math.min(anchorDay, lastDay));
  } else if (durationUnit === 'TRIAL') {
    // один календарный день
  } else {
    return null;
  }
  return end;
}
