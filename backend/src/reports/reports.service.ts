import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
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
  constructor(private readonly prisma: PrismaService) {}

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
    const rangeMs = Math.max(24 * 60 * 60 * 1000, currentTo.getTime() - currentFrom.getTime() + 1);
    const prevFrom = new Date(currentFrom.getTime() - rangeMs);
    const prevTo = new Date(currentTo.getTime() - rangeMs);

    const [clientCount, activeMemberships, totalMemberships, paidAgg, paidPrevAgg, failedPayments, highLoadClasses] =
      await this.prisma.$transaction([
        this.prisma.client.count(),
        this.prisma.membership.count({ where: { status: 'ACTIVE' } }),
        this.prisma.membership.count(),
        this.prisma.payment.aggregate({
          where: { status: PaymentStatus.PAID, paidAt: paidAtRange },
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
        this.prisma.payment.findMany({
          where: { status: PaymentStatus.FAILED, paidAt: paidAtRange },
          select: { id: true, amount: true, paidAt: true },
          orderBy: { paidAt: 'desc' },
        }),
        this.prisma.gymClass.findMany({
          where: {
            startTime: {
              gte: from ? startOfDay(from) : undefined,
              lte: to ? endOfDay(to) : undefined,
            },
          },
          include: { _count: { select: { bookings: true } } },
        }),
      ]);

    const highLoadCount = highLoadClasses.filter((row) => {
      if (!row.capacity) return false;
      return (row._count.bookings / row.capacity) * 100 >= 85;
    }).length;

    const paidAmount = decimalToNumber(paidAgg._sum.amount);
    const paidBaseline = decimalToNumber(paidPrevAgg._sum.amount);

    return {
      period: {
        from: from ? startOfDay(from).toISOString() : null,
        to: to ? endOfDay(to).toISOString() : null,
      },
      finance: {
        paidAmount,
        paidCount: paidAgg._count.id,
        trendPct: safePct(paidAmount, paidBaseline),
        failedAmount: failedPayments.reduce((acc, item) => acc + decimalToNumber(item.amount), 0),
        failedCount: failedPayments.length,
      },
      clients: {
        totalClients: clientCount,
        activeMemberships,
        activeMembershipSharePct:
          totalMemberships > 0 ? Number(((activeMemberships / totalMemberships) * 100).toFixed(1)) : 0,
      },
      risks: {
        highLoadClasses: highLoadCount,
      },
    };
  }
}
