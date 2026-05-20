import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentOperationType, PaymentStatus, Prisma } from '@prisma/client';
import { RequestContextService } from '../common/request-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService (integration)', () => {
  let service: PaymentsService;
  let prisma: {
    client: { findUnique: jest.Mock };
    contractDocument: { findFirst: jest.Mock };
    payment: {
      aggregate: jest.Mock;
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const actorId = 'user-1';
  const clientId = 'client-1';
  const contractId = 'contract-1';

  beforeEach(async () => {
    prisma = {
      client: { findUnique: jest.fn() },
      contractDocument: { findFirst: jest.fn() },
      payment: {
        aggregate: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (tx: typeof prisma) => unknown) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: RequestContextService,
          useValue: { getRequestId: () => 'req-test' },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
    prisma.client.findUnique.mockResolvedValue({ id: clientId });
    prisma.contractDocument.findFirst.mockResolvedValue({ id: contractId });
  });

  function mockContractBalance(paid: string, refunded = '0', servicePrice = '1000.00') {
    prisma.contractDocument.findFirst.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === contractId) {
        return { servicePrice: new Prisma.Decimal(servicePrice) };
      }
      return null;
    });
    prisma.payment.aggregate.mockImplementation(async (args: { where: { operationType: string } }) => {
      if (args.where.operationType === PaymentOperationType.SALE) {
        return { _sum: { amount: new Prisma.Decimal(paid) } };
      }
      return { _sum: { amount: new Prisma.Decimal(refunded) } };
    });
  }

  it('creates PAID payment when amount fits contract balance inside transaction', async () => {
    mockContractBalance('400.00');
    prisma.payment.create.mockResolvedValue({
      id: 'pay-1',
      clientId,
      contractDocumentId: contractId,
      amount: new Prisma.Decimal('500.00'),
      paidAt: new Date(),
      status: PaymentStatus.PAID,
      operationType: PaymentOperationType.SALE,
      channel: 'CASH',
      refundMethod: null,
      comment: null,
      processedBy: null,
    });

    const result = await service.create(
      {
        clientId,
        contractDocumentId: contractId,
        amount: 500,
        status: PaymentStatus.PAID,
      },
      actorId,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('pay-1');
  });

  it('rejects PAID payment exceeding remaining contract balance', async () => {
    mockContractBalance('950.00');

    await expect(
      service.create(
        {
          clientId,
          contractDocumentId: contractId,
          amount: 100,
          status: PaymentStatus.PAID,
        },
        actorId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('skips balance check for PENDING payments', async () => {
    prisma.payment.create.mockResolvedValue({
      id: 'pay-pending',
      clientId,
      contractDocumentId: contractId,
      amount: new Prisma.Decimal('9999.00'),
      paidAt: new Date(),
      status: PaymentStatus.PENDING,
      operationType: PaymentOperationType.SALE,
      channel: 'CASH',
      refundMethod: null,
      comment: null,
      processedBy: null,
    });

    await service.create(
      {
        clientId,
        contractDocumentId: contractId,
        amount: 9999,
        status: PaymentStatus.PENDING,
      },
      actorId,
    );

    expect(prisma.payment.aggregate).not.toHaveBeenCalled();
    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
  });

  it('throws when client not found', async () => {
    prisma.client.findUnique.mockResolvedValue(null);

    await expect(
      service.create({ clientId, amount: 100 }, actorId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
