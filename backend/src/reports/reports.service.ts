import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { ContractsService } from '../contracts/contracts.service';
import { PrismaService } from '../prisma/prisma.service';

function decimalToNumber(value: Prisma.Decimal | null | undefined): number {
  return value ? Number(value) : 0;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function safePct(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: ContractsService,
  ) {}

  async getOverview(filters?: { from?: string; to?: string }) {
    const from = filters?.from ? new Date(filters.from) : null;
    const to = filters?.to ? new Date(filters.to) : null;

    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      throw new BadRequestException({ code: 'INVALID_DATE_FILTER', message: 'Invalid date format in reports filter' });
    }
    if (from && to && from > to) {
      throw new BadRequestException({ code: 'INVALID_DATE_RANGE', message: 'Invalid date range in reports filter' });
    }

    const paidAtRange =
      from || to
        ? {
            gte: from ? startOfDay(from) : undefined,
            lte: to ? endOfDay(to) : undefined,
          }
        : undefined;
    const currentFrom = paidAtRange?.gte ?? startOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const currentTo = paidAtRange?.lte ?? endOfDay(new Date());
    /** Единое окно для сумм по оплатам (если в фильтре только одна граница — добиваем дефолтом месяц/сегодня). */
    const effFrom = paidAtRange?.gte ?? currentFrom;
    const effTo = paidAtRange?.lte ?? currentTo;
    const paidWindow = { gte: effFrom, lte: effTo };

    const rangeMs = Math.max(24 * 60 * 60 * 1000, currentTo.getTime() - currentFrom.getTime() + 1);
    const prevFrom = new Date(currentFrom.getTime() - rangeMs);
    const prevTo = new Date(currentTo.getTime() - rangeMs);

    const [
      clientCount,
      paidAgg,
      paidPrevAgg,
      refundAgg,
      failedAgg,
      visitSessionsCount,
      newClientsCount,
      contractsCreatedCount,
      installmentAgg,
    ] = await this.prisma.$transaction([
      this.prisma.client.count(),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.PAID, paidAt: paidWindow },
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.PAID,
          paidAt: { gte: prevFrom, lte: prevTo },
        },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.REFUNDED, paidAt: paidWindow },
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.FAILED, paidAt: paidWindow },
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.visitSession.count({
        where: { enteredAt: { gte: effFrom, lte: effTo } },
      }),
      this.prisma.client.count({
        where: { createdAt: { gte: effFrom, lte: effTo } },
      }),
      this.prisma.contractDocument.count({
        where: { createdAt: { gte: effFrom, lte: effTo } },
      }),
      this.prisma.$queryRaw<Array<{ s: unknown; c: bigint }>>(
        Prisma.sql`
          SELECT COALESCE(SUM(p.amount), 0) AS s, COUNT(p.id)::bigint AS c
          FROM "Payment" p
          INNER JOIN "ContractDocument" cd ON cd.id = p."contractDocumentId"
          WHERE p.status = 'PAID'::"PaymentStatus"
            AND p."paidAt" >= ${effFrom}
            AND p."paidAt" <= ${effTo}
            AND (cd.payload->>'paymentPlan') IN ('INSTALLMENT_FLEXIBLE', 'INSTALLMENT_EQUAL')
        `,
      ),
    ]);

    const activeClientsCount = await this.contracts.countClientsWithDerivedActiveContract();

    const paidAmount = decimalToNumber(paidAgg._sum.amount);
    const paidBaseline = decimalToNumber(paidPrevAgg._sum.amount);
    const instRow = installmentAgg[0];
    const installmentPaidAmount = decimalToNumber(instRow?.s as Prisma.Decimal | null | undefined);
    const installmentPaidCount = Number(instRow?.c ?? 0);

    return {
      period: {
        from: from ? startOfDay(from).toISOString() : null,
        to: to ? endOfDay(to).toISOString() : null,
      },
      finance: {
        paidAmount,
        paidCount: paidAgg._count.id,
        trendPct: safePct(paidAmount, paidBaseline),
        refundAmount: decimalToNumber(refundAgg._sum.amount),
        refundCount: refundAgg._count.id,
        installmentPaidAmount,
        installmentPaidCount,
        failedAmount: decimalToNumber(failedAgg._sum.amount),
        failedCount: failedAgg._count.id,
      },
      clients: {
        totalClients: clientCount,
        activeClients: activeClientsCount,
        activeClientsSharePct:
          clientCount > 0 ? Number(((activeClientsCount / clientCount) * 100).toFixed(1)) : 0,
      },
      activity: {
        visitSessionsCount,
        newClientsCount,
        contractsCreatedCount,
      },
    };
  }
}
