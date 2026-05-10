import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { RequestContextService } from '../common/request-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}
  private readonly logger = new Logger(PaymentsService.name);
  private readonly errors = {
    clientNotFound: { code: 'CLIENT_NOT_FOUND', message: 'Client not found' },
    contractNotFoundForClient: { code: 'CONTRACT_NOT_FOUND_FOR_CLIENT', message: 'Contract not found for client' },
    invalidDateFilter: { code: 'INVALID_DATE_FILTER', message: 'Invalid date filter' },
    invalidDateRange: { code: 'INVALID_DATE_RANGE', message: 'Invalid date range' },
    paymentNotFound: { code: 'PAYMENT_NOT_FOUND', message: 'Payment not found' },
    paymentDeleteDisabled: {
      code: 'PAYMENT_DELETE_DISABLED',
      message: 'Payment deletion is disabled. Use refund operations instead.',
    },
  } as const;

  async create(dto: CreatePaymentDto, actorId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: dto.clientId },
      select: { id: true },
    });
    if (!client) throw new NotFoundException(this.errors.clientNotFound);

    if (dto.contractDocumentId) {
      const contract = await this.prisma.contractDocument.findFirst({
        where: { id: dto.contractDocumentId, clientId: dto.clientId },
        select: { id: true },
      });
      if (!contract) throw new NotFoundException(this.errors.contractNotFoundForClient);
    }

    const created = await this.prisma.payment.create({
      data: {
        clientId: dto.clientId,
        contractDocumentId: dto.contractDocumentId,
        amount: new Prisma.Decimal(dto.amount),
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        status: dto.status ?? PaymentStatus.PENDING,
        operationType: 'SALE',
        comment: dto.comment?.trim() || null,
        processedById: actorId,
      },
      select: {
        id: true,
        clientId: true,
        contractDocumentId: true,
        amount: true,
        paidAt: true,
        status: true,
        operationType: true,
        refundMethod: true,
        comment: true,
        processedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    this.logger.log(
      `AUDIT payment.create reqId=${this.requestContext.getRequestId()} actorId=${actorId} paymentId=${created.id} clientId=${dto.clientId} amount=${dto.amount}`,
    );
    return created;
  }

  async listByClient(clientId: string) {
    return this.prisma.payment.findMany({
      where: { clientId },
      orderBy: { paidAt: 'desc' },
      select: {
        id: true,
        amount: true,
        paidAt: true,
        status: true,
        operationType: true,
        refundMethod: true,
        comment: true,
        contractDocumentId: true,
        contract: { select: { id: true, contractNumber: true, s3Url: true } },
        processedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async list(filters?: ListPaymentsQueryDto) {
    const rawStatus = typeof filters?.status === 'string' ? filters.status.trim().toUpperCase() : undefined;
    const normalizedStatus: PaymentStatus | undefined =
      rawStatus === 'REFUND'
        ? 'REFUNDED'
        : rawStatus && (Object.values(PaymentStatus) as string[]).includes(rawStatus)
          ? (rawStatus as PaymentStatus)
          : undefined;
    const fromDate = filters?.from ? new Date(filters.from) : null;
    const toDate = filters?.to ? new Date(filters.to) : null;
    if ((filters?.from && (fromDate == null || Number.isNaN(fromDate.getTime()))) || (filters?.to && (toDate == null || Number.isNaN(toDate.getTime())))) {
      throw new BadRequestException(this.errors.invalidDateFilter);
    }
    if (fromDate && toDate && fromDate > toDate) {
      throw new BadRequestException(this.errors.invalidDateRange);
    }

    const q = filters?.q?.trim();
    const clientSearchWhere: Prisma.ClientWhereInput | undefined = q
      ? {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { middleName: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
          ],
        }
      : undefined;

    const where: Prisma.PaymentWhereInput = {
      contractDocumentId: filters?.contractDocumentId || undefined,
      status: normalizedStatus || undefined,
      paidAt:
        filters?.from || filters?.to
          ? {
              gte: fromDate ?? undefined,
              lte: toDate ?? undefined,
            }
          : undefined,
    };

    if (filters?.clientId && clientSearchWhere) {
      where.AND = [{ clientId: filters.clientId }, { client: { is: clientSearchWhere } }];
    } else if (filters?.clientId) {
      where.clientId = filters.clientId;
    } else if (clientSearchWhere) {
      where.client = { is: clientSearchWhere };
    }

    return this.prisma.payment.findMany({
      where,
      orderBy: { paidAt: 'desc' },
      select: {
        id: true,
        clientId: true,
        contractDocumentId: true,
        amount: true,
        paidAt: true,
        status: true,
        operationType: true,
        refundMethod: true,
        comment: true,
        contract: { select: { id: true, contractNumber: true, s3Url: true } },
        client: { select: { id: true, firstName: true, lastName: true, middleName: true } },
        processedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.payment.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(this.errors.paymentNotFound);
    this.logger.warn(
      `AUDIT payment.delete_blocked reqId=${this.requestContext.getRequestId()} paymentId=${id}`,
    );
    throw new BadRequestException(this.errors.paymentDeleteDisabled);
  }
}
