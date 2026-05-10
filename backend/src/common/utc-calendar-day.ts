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
