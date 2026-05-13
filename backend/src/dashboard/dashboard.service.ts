import { Injectable } from '@nestjs/common';
import { MembershipStatus, PaymentStatus, Prisma } from '@prisma/client';
import { ContractsService } from '../contracts/contracts.service';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function safePct(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function decimalToNumber(value: Prisma.Decimal | null | undefined): number {
  return value ? Number(value) : 0;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: ContractsService,
  ) {}

  async getSummary() {
    const now = new Date();
    const monthStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    const prevMonthStart = startOfDay(
      new Date(now.getFullYear(), now.getMonth() - 1, 1),
    );
    const dayStart = startOfDay(now);
    const from30Days = addDays(dayStart, -29);
    const nextDay = addDays(dayStart, 1);
    const activityRange = { gte: from30Days, lt: nextDay };

    const [
      clientCount,
      monthRevenueAgg,
      prevMonthRevenueAgg,
      visitSessions30d,
      newClients30d,
      contractsCreated30d,
    ] = await this.prisma.$transaction([
      this.prisma.client.count(),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.PAID, paidAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.PAID,
          paidAt: { gte: prevMonthStart, lt: monthStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.visitSession.count({
        where: { enteredAt: activityRange },
      }),
      this.prisma.client.count({
        where: { createdAt: activityRange },
      }),
      this.prisma.contractDocument.count({
        where: { createdAt: activityRange },
      }),
    ]);

    const monthRevenue = decimalToNumber(monthRevenueAgg._sum.amount);
    const prevMonthRevenue = decimalToNumber(prevMonthRevenueAgg._sum.amount);

    const activeClientsFromContracts =
      await this.contracts.countClientsWithDerivedActiveContract();

    return {
      kpis: {
        clients: {
          value: clientCount,
        },
        activeClients: {
          value: activeClientsFromContracts,
          sharePct:
            clientCount > 0
              ? Number(((activeClientsFromContracts / clientCount) * 100).toFixed(1))
              : 0,
        },
        revenueMonth: {
          value: monthRevenue,
          trendPct: safePct(monthRevenue, prevMonthRevenue),
        },
        activity30d: {
          visitSessions: visitSessions30d,
          newClients: newClients30d,
          contractsCreated: contractsCreated30d,
        },
      },
    };
  }

  async getCharts() {
    const now = startOfDay(new Date());
    const from30Days = addDays(now, -29);

    const [payments, visits, newClientsRows, contractsRows] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where: {
          status: PaymentStatus.PAID,
          paidAt: { gte: from30Days },
        },
        select: { amount: true, paidAt: true },
        orderBy: { paidAt: 'asc' },
      }),
      this.prisma.visitSession.findMany({
        where: { enteredAt: { gte: from30Days } },
        select: { enteredAt: true },
        orderBy: { enteredAt: 'asc' },
      }),
      this.prisma.client.findMany({
        where: { createdAt: { gte: from30Days } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.contractDocument.findMany({
        where: { createdAt: { gte: from30Days } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const contractsByDerivedStatus = await this.contracts.getContractsDerivedDistribution();

    const days = Array.from({ length: 30 }, (_, i) => isoDay(addDays(from30Days, i)));
    const revenueMap = new Map<string, number>();
    for (const day of days) revenueMap.set(day, 0);
    for (const p of payments) {
      const key = isoDay(p.paidAt);
      revenueMap.set(key, (revenueMap.get(key) ?? 0) + decimalToNumber(p.amount));
    }
    const visitsMap = new Map<string, number>();
    for (const day of days) visitsMap.set(day, 0);
    for (const v of visits) {
      const key = isoDay(v.enteredAt);
      visitsMap.set(key, (visitsMap.get(key) ?? 0) + 1);
    }

    const newClientsMap = new Map<string, number>();
    for (const day of days) newClientsMap.set(day, 0);
    for (const row of newClientsRows) {
      const key = isoDay(row.createdAt);
      newClientsMap.set(key, (newClientsMap.get(key) ?? 0) + 1);
    }

    const contractsMap = new Map<string, number>();
    for (const day of days) contractsMap.set(day, 0);
    for (const row of contractsRows) {
      const key = isoDay(row.createdAt);
      contractsMap.set(key, (contractsMap.get(key) ?? 0) + 1);
    }

    return {
      revenueByDay: days.map((day) => ({ day, value: revenueMap.get(day) ?? 0 })),
      visitsByDay: days.map((day) => ({ day, value: visitsMap.get(day) ?? 0 })),
      newClientsByDay: days.map((day) => ({
        day,
        value: newClientsMap.get(day) ?? 0,
      })),
      contractsByDay: days.map((day) => ({
        day,
        value: contractsMap.get(day) ?? 0,
      })),
      membershipsByStatus: contractsByDerivedStatus,
    };
  }

  async getAlerts() {
    const now = new Date();
    const weekAhead = addDays(now, 7);
    const weekAgo = addDays(now, -7);

    const [expiringMemberships, failedPayments] = await this.prisma.$transaction([
      this.prisma.membership.findMany({
        where: {
          status: MembershipStatus.ACTIVE,
          endDate: { gte: now, lte: weekAhead },
        },
        include: {
          client: {
            select: { id: true, name: true, phone: true },
          },
        },
        orderBy: { endDate: 'asc' },
        take: 5,
      }),
      this.prisma.payment.findMany({
        where: {
          status: PaymentStatus.FAILED,
          paidAt: { gte: weekAgo },
        },
        orderBy: { paidAt: 'desc' },
        take: 5,
      }),
    ]);

    return {
      expiringMemberships: expiringMemberships.map((m) => ({
        id: m.id,
        clientName: m.client.name,
        phone: m.client.phone,
        endDate: m.endDate,
      })),
      failedPayments: failedPayments.map((p) => ({
        id: p.id,
        amount: decimalToNumber(p.amount),
        paidAt: p.paidAt,
      })),
    };
  }
}
