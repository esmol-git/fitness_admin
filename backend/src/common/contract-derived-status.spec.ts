import { deriveContractDerivedStatus } from './contract-derived-status';

describe('deriveContractDerivedStatus', () => {
  it('returns SAVED when service start is missing', () => {
    expect(deriveContractDerivedStatus('ACTIVE', null, new Date('2026-12-31'))).toBe('SAVED');
  });

  it('returns SAVED when service start is in the future', () => {
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 1);
    expect(deriveContractDerivedStatus('ACTIVE', future, null)).toBe('SAVED');
  });

  it('returns EXPIRED when service end is before today', () => {
    expect(
      deriveContractDerivedStatus('ACTIVE', new Date('2020-01-01'), new Date('2020-06-01')),
    ).toBe('EXPIRED');
  });

  it('returns PAUSED for paused workflow status', () => {
    expect(
      deriveContractDerivedStatus('PAUSED', new Date('2020-01-01'), new Date('2030-06-01')),
    ).toBe('PAUSED');
  });

  it('returns CANCELLED unchanged', () => {
    expect(deriveContractDerivedStatus('CANCELLED', null, null)).toBe('CANCELLED');
  });
});
