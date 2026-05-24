import { normalizeLockerNumber } from './locker-number';

describe('normalizeLockerNumber', () => {
  it('keeps up to 4 digits', () => {
    expect(normalizeLockerNumber('75')).toBe('75');
    expect(normalizeLockerNumber('1234')).toBe('1234');
    expect(normalizeLockerNumber('12345')).toBe('1234');
  });

  it('strips non-digits', () => {
    expect(normalizeLockerNumber('ab12cd34')).toBe('1234');
  });

  it('returns null for empty', () => {
    expect(normalizeLockerNumber('')).toBeNull();
    expect(normalizeLockerNumber('   ')).toBeNull();
    expect(normalizeLockerNumber(null)).toBeNull();
  });
});
