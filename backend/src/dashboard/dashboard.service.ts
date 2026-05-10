import { Injectable } from '@nestjs/common';
import {
  MembershipStatus,
  PaymentStatus,
  Prisma,
  Role,
} from '@prisma/client';
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
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const now = new Date();
    const monthStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    const prevMonthStart = startOfDay(
      new Date(now.getFullYear(), now.getMonth() - 1, 1),
    );
    const rollingStart = addDays(startOfDay(now), -30);
    const prevRollingStart = addDays(startOfDay(now), -60);

    const [
      employeeCount,
      clientCount,
      activeMemberships,
      totalMemberships,
      monthRevenueAgg,
      prevMonthRevenueAgg,
      hiredLast30Days,
      hiredPrev30Days,
      adminCount,
      managerCount,
      trainerCount,
      receptionistCount,
      traineeCount,
      recentEmployees,
      employeesCreatedLast30Days,
    ] = await this.prisma.$transaction([
      this.prisma.user.count({ where: { isEmployee: true } }),
      this.prisma.client.count(),
      this.prisma.membership.count({
        where: { status: MembershipStatus.ACTIVE },
      }),
      this.prisma.membership.count(),
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
      this.prisma.user.count({ where: { createdAt: { gte: rollingStart } } }),
      this.prisma.user.count({
        where: { createdAt: { gte: prevRollingStart, lt: rollingStart } },
      }),
      this.prisma.user.count({ where: { role: Role.ADMIN } }),
      this.prisma.user.count({ where: { role: Role.MANAGER } }),
      this.prisma.user.count({ where: { role: Role.TRAINER } }),
      this.prisma.user.count({ where: { role: Role.RECEPTIONIST } }),
      this.prisma.user.count({ where: { role: Role.TRAINEE } }),
      this.prisma.user.findMany({
        where: { isEmployee: true },
        select: {
          id: true,
          login: true,
          firstName: true,
          lastName: true,
          role: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.user.findMany({
        where: { createdAt: { gte: rollingStart } },
        select: { createdAt: true },
      }),
    ]);

    const monthRevenue = decimalToNumber(monthRevenueAgg._sum.amount);
    const prevMonthRevenue = decimalToNumber(prevMonthRevenueAgg._sum.amount);

    const days = Array.from({ length: 30 }, (_, i) => isoDay(addDays(rollingStart, i)));
    const employeesByDay = new Map<string, number>();
    for (const day of days) employeesByDay.set(day, 0);
    for (const row of employeesCreatedLast30Days) {
      const day = isoDay(row.createdAt);
      employeesByDay.set(day, (employeesByDay.get(day) ?? 0) + 1);
    }

    return {
      kpis: {
        employees: {
          value: employeeCount,
          trendPct: safePct(hiredLast30Days, hiredPrev30Days),
          metaValue: hiredLast30Days,
        },
        clients: {
          value: clientCount,
        },
        membershipsActive: {
          value: activeMemberships,
          sharePct:
            totalMemberships > 0
              ? Number(((activeMemberships / totalMemberships) * 100).toFixed(1))
              : 0,
        },
        revenueMonth: {
          value: monthRevenue,
          trendPct: safePct(monthRevenue, prevMonthRevenue),
        },
      },
      roleDistribution: [
        { role: Role.ADMIN, value: adminCount },
        { role: Role.MANAGER, value: managerCount },
        { role: Role.TRAINER, value: trainerCount },
        { role: Role.RECEPTIONIST, value: receptionistCount },
        { role: Role.TRAINEE, value: traineeCount },
      ],
      recentEmployees: recentEmployees.map((u) => ({
        id: u.id,
        login: u.login,
        fullName:
          [u.firstName, u.lastName]
            .filter((v): v is string => Boolean(v))
            .join(' ') || u.login,
        role: u.role,
        createdAt: u.createdAt,
      })),
      employeesByDay: days.map((day) => ({ day, value: employeesByDay.get(day) ?? 0 })),
    };
  }

  async getCharts() {
    const now = startOfDay(new Date());
    const from30Days = addDays(now, -29);

    const [
      payments,
      attendances,
      activeMembershipCount,
      expiredMembershipCount,
      cancelledMembershipCount,
      trainers,
    ] =
      await this.prisma.$transaction([
        this.prisma.payment.findMany({
          where: {
            status: PaymentStatus.PAID,
            paidAt: { gte: from30Days },
          },
          select: { amount: true, paidAt: true },
          orderBy: { paidAt: 'asc' },
        }),
        this.prisma.attendance.findMany({
          where: { checkIn: { gte: from30Days } },
          select: { checkIn: true },
          orderBy: { checkIn: 'asc' },
        }),
        this.prisma.membership.count({ where: { status: MembershipStatus.ACTIVE } }),
        this.prisma.membership.count({ where: { status: MembershipStatus.EXPIRED } }),
        this.prisma.membership.count({
          where: { status: MembershipStatus.CANCELLED },
        }),
        this.prisma.user.findMany({
          where: { role: Role.TRAINER },
          select: {
            id: true,
            login: true,
            firstName: true,
            lastName: true,
            _count: {
              select: {
                gymClasses: true,
                clientLinks: true,
              },
            },
          },
        }),
      ]);

    const days = Array.from({ length: 30 }, (_, i) => isoDay(addDays(from30Days, i)));
    const revenueMap = new Map<string, number>();
    for (const day of days) revenueMap.set(day, 0);
    for (const p of payments) {
      const key = isoDay(p.paidAt);
      revenueMap.set(key, (revenueMap.get(key) ?? 0) + decimalToNumber(p.amount));
    }
    const attendanceMap = new Map<string, number>();
    for (const day of days) attendanceMap.set(day, 0);
    for (const a of attendances) {
      const key = isoDay(a.checkIn);
      attendanceMap.set(key, (attendanceMap.get(key) ?? 0) + 1);
    }

    const trainerLoad = trainers
      .map((t) => ({
        trainerId: t.id,
        label:
          [t.firstName, t.lastName].filter((v): v is string => Boolean(v)).join(' ') ||
          t.login,
        classesCount: t._count.gymClasses,
        clientsCount: t._count.clientLinks,
      }))
      .sort(
        (a, b) =>
          b.classesCount + b.clientsCount - (a.classesCount + a.clientsCount),
      )
      .slice(0, 7);

    return {
      revenueByDay: days.map((day) => ({ day, value: revenueMap.get(day) ?? 0 })),
      attendanceByDay: days.map((day) => ({
        day,
        value: attendanceMap.get(day) ?? 0,
      })),
      membershipsByStatus: [
        { status: 'ACTIVE', value: activeMembershipCount },
        { status: 'EXPIRED', value: expiredMembershipCount },
        { status: 'CANCELLED', value: cancelledMembershipCount },
      ],
      trainerLoad,
    };
  }

  async getAlerts() {
    const now = new Date();
    const weekAhead = addDays(now, 7);
    const weekAgo = addDays(now, -7);

    const [expiringMemberships, failedPayments, upcomingClasses] =
      await this.prisma.$transaction([
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
        this.prisma.gymClass.findMany({
          where: { startTime: { gte: now } },
          include: {
            trainer: {
              select: { login: true, firstName: true, lastName: true },
            },
            _count: { select: { bookings: true } },
          },
          orderBy: { startTime: 'asc' },
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
      upcomingClasses: upcomingClasses.map((c) => ({
        id: c.id,
        name: c.name,
        startTime: c.startTime,
        capacity: c.capacity,
        booked: c._count.bookings,
        occupancyPct:
          c.capacity > 0
            ? Number(((c._count.bookings / c.capacity) * 100).toFixed(1))
            : 0,
        trainer:
          [c.trainer.firstName, c.trainer.lastName]
            .filter((v): v is string => Boolean(v))
            .join(' ') || c.trainer.login,
      })),
    };
  }
}
