import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClientStatus, VisitSessionStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { RequestContextService } from '../common/request-context.service';
import { ContractsService } from '../contracts/contracts.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { VisitsService } from './visits.service';

describe('VisitsService checkIn (integration)', () => {
  let service: VisitsService;
  let prisma: {
    $executeRaw: jest.Mock;
    client: { findFirst: jest.Mock };
    visitSession: {
      findFirst: jest.Mock;
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const actorId = 'user-1';
  const activeClient = {
    id: 'client-1',
    firstName: 'Ivan',
    lastName: 'Ivanov',
    middleName: null,
    phone: '+7900',
    cardNumber: 'CARD001',
    status: ClientStatus.ACTIVE,
    photoUrl: null,
  };

  beforeEach(async () => {
    prisma = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      client: { findFirst: jest.fn() },
      visitSession: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (tx: typeof prisma) => unknown) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisitsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: RequestContextService,
          useValue: { getRequestId: () => 'req-test' },
        },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: StorageService, useValue: { presignGetUrlForStoredPublicUrl: jest.fn() } },
        {
          provide: ContractsService,
          useValue: { getPrimaryContractUnpaidSummaryForVisitLookup: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(VisitsService);
    prisma.client.findFirst.mockResolvedValue(activeClient);
  });

  it('creates visit session when client is active and locker is free', async () => {
    prisma.visitSession.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.visitSession.create.mockResolvedValue({
      id: 'session-1',
      lockerNumber: '101',
      enteredAt: new Date('2026-05-20T10:00:00.000Z'),
    });

    const result = await service.checkIn('CARD001', '101', actorId);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.visitSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: activeClient.id,
          lockerNumber: '101',
          status: VisitSessionStatus.IN_GYM,
          enteredById: actorId,
        }),
      }),
    );
    expect(result.action).toBe('CHECK_IN');
    expect(result.session.id).toBe('session-1');
  });

  it('rejects when client already has open visit', async () => {
    prisma.visitSession.findFirst.mockResolvedValueOnce({
      id: 'open-1',
      lockerNumber: '55',
      enteredAt: new Date(),
      status: VisitSessionStatus.IN_GYM,
    });

    await expect(service.checkIn('CARD001', '101', actorId)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'OPEN_VISIT_EXISTS' }),
    });
    expect(prisma.visitSession.create).not.toHaveBeenCalled();
  });

  it('rejects when locker is already occupied', async () => {
    prisma.visitSession.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'other-session', clientId: 'client-2' });

    await expect(service.checkIn('CARD001', '101', actorId)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.visitSession.create).not.toHaveBeenCalled();
  });

  it('rejects inactive client before transaction', async () => {
    prisma.client.findFirst.mockResolvedValue({
      ...activeClient,
      status: ClientStatus.PAUSED,
    });

    await expect(service.checkIn('CARD001', '101', actorId)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ONLY_ACTIVE_ALLOWED' }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws when client code not found', async () => {
    prisma.client.findFirst.mockResolvedValue(null);

    await expect(service.checkIn('UNKNOWN', '101', actorId)).rejects.toBeInstanceOf(NotFoundException);
  });
});
