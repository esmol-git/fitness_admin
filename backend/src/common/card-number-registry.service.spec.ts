import { ConflictException } from '@nestjs/common';
import { CardNumberRegistryService } from './card-number-registry.service';

describe('CardNumberRegistryService', () => {
  const prisma = {
    client: { findUnique: jest.fn() },
    serviceStaff: { findFirst: jest.fn() },
  };
  const service = new CardNumberRegistryService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true for empty card number', async () => {
    await expect(service.isAvailable('   ')).resolves.toBe(true);
    expect(prisma.client.findUnique).not.toHaveBeenCalled();
  });

  it('returns false when card exists on client', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.serviceStaff.findFirst.mockResolvedValue(null);
    await expect(service.isAvailable('12345')).resolves.toBe(false);
  });

  it('returns false when card exists on staff', async () => {
    prisma.client.findUnique.mockResolvedValue(null);
    prisma.serviceStaff.findFirst.mockResolvedValue({ id: 's1' });
    await expect(service.isAvailable('12345')).resolves.toBe(false);
  });

  it('allows same card when excluding owning client', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.serviceStaff.findFirst.mockResolvedValue(null);
    await expect(service.isAvailable('12345', { clientId: 'c1' })).resolves.toBe(true);
  });

  it('allows same card when excluding owning staff', async () => {
    prisma.client.findUnique.mockResolvedValue(null);
    prisma.serviceStaff.findFirst.mockResolvedValue({ id: 's1' });
    await expect(service.isAvailable('12345', { staffId: 's1' })).resolves.toBe(true);
  });

  it('throws ConflictException from assertAvailable', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.serviceStaff.findFirst.mockResolvedValue(null);
    await expect(service.assertAvailable('12345')).rejects.toBeInstanceOf(ConflictException);
  });
});
