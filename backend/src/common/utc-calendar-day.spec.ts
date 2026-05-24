import {
  actualFreezeDaysOnResumeUtc,
  addCalendarDurationUtc,
  addUtcCalendarDays,
  addUtcCalendarDaysInclusiveEnd,
  diffDaysInclusiveUtc,
  isoYmdFromUtcDate,
  maxUtcCalendarDate,
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

  it('addUtcCalendarDaysInclusiveEnd matches inclusive day count', () => {
    const start = utcDateFromIsoYmd('2026-05-24')!;
    const end = addUtcCalendarDaysInclusiveEnd(start, 7);
    expect(isoYmdFromUtcDate(end)).toBe('2026-05-30');
    expect(diffDaysInclusiveUtc(start, end)).toBe(7);
  });

  it('addUtcCalendarDays extends contract end without local TZ shift', () => {
    const end = utcDateFromIsoYmd('2026-05-16')!;
    const extended = addUtcCalendarDays(end, 7);
    expect(isoYmdFromUtcDate(extended)).toBe('2026-05-23');
  });

  it('maxUtcCalendarDate picks later civil day', () => {
    const a = utcDateFromIsoYmd('2026-05-22')!;
    const b = utcDateFromIsoYmd('2026-05-24')!;
    expect(isoYmdFromUtcDate(maxUtcCalendarDate(a, b))).toBe('2026-05-24');
  });

  it('actualFreezeDaysOnResumeUtc is 0 when freeze and resume are the same day', () => {
    const day = utcDateFromIsoYmd('2026-05-24')!;
    expect(actualFreezeDaysOnResumeUtc(day, day)).toBe(0);
  });

  it('actualFreezeDaysOnResumeUtc counts inclusive days across different days', () => {
    const start = utcDateFromIsoYmd('2026-05-24')!;
    const resume = utcDateFromIsoYmd('2026-05-26')!;
    expect(actualFreezeDaysOnResumeUtc(start, resume)).toBe(3);
  });
});
