import {
  addCalendarDurationUtc,
  diffDaysInclusiveUtc,
  isoYmdFromUtcDate,
  utcCalendarDayMs,
  utcDateFromIsoYmd,
} from './utc-calendar-day';

describe('utc-calendar-day', () => {
  it('utcDateFromIsoYmd parses YYYY-MM-DD as UTC midnight', () => {
    const d = utcDateFromIsoYmd('2026-05-22');
    expect(d?.toISOString()).toBe('2026-05-22T00:00:00.000Z');
  });

  it('isoYmdFromUtcDate does not shift calendar day in UTC+ timezones', () => {
    const d = new Date('2026-05-22T23:30:00.000Z');
    expect(isoYmdFromUtcDate(d)).toBe('2026-05-22');
  });

  it('diffDaysInclusiveUtc counts inclusive calendar days', () => {
    const start = utcDateFromIsoYmd('2026-05-20')!;
    const end = utcDateFromIsoYmd('2026-05-22')!;
    expect(diffDaysInclusiveUtc(start, end)).toBe(3);
  });

  it('addCalendarDurationUtc adds months on UTC calendar', () => {
    const start = utcDateFromIsoYmd('2026-01-31')!;
    const end = addCalendarDurationUtc(start, 1, 'MONTH');
    expect(end).not.toBeNull();
    expect(isoYmdFromUtcDate(end!)).toBe('2026-02-28');
  });

  it('utcCalendarDayMs compares civil dates regardless of time', () => {
    const a = new Date('2026-05-22T15:00:00.000Z');
    const b = new Date('2026-05-22T02:00:00.000Z');
    expect(utcCalendarDayMs(a)).toBe(utcCalendarDayMs(b));
  });
});
