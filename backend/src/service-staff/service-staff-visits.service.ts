import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ServiceStaffStatus, VisitCloseReason, VisitSessionStatus } from '@prisma/client';
import { RequestContextService } from '../common/request-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ListStaffVisitsQueryDto, type ListStaffVisitsSortBy } from './dto/list-staff-visits-query.dto';

@Injectable()
export class ServiceStaffVisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}
  private readonly logger = new Logger(ServiceStaffVisitsService.name);

  private readonly errors = {
    notFound: { code: 'SERVICE_STAFF_NOT_FOUND', message: 'Service staff not found' },
    onlyActive: { code: 'ONLY_ACTIVE_ALLOWED', message: 'Only active staff can enter' },
    alreadyIn: { code: 'OPEN_VISIT_EXISTS', message: 'Staff already has open visit session' },
    notInGym: { code: 'NOT_IN_GYM', message: 'Staff is not in gym' },
  } as const;

  private normalizeCode(value: string) {
    return value.trim();
  }

  private photoReadTtlSec() {
    const v = Number(this.config.get('S3_PHOTO_READ_TTL_SEC'));
    return Number.isFinite(v) && v >= 60 ? Math.floor(v) : 604800;
  }

  private async withReadablePhotoUrl<T extends { photoUrl: string | null }>(row: T): Promise<T> {
    if (!row.photoUrl?.trim()) return row;
    const url = await this.storage.presignGetUrlForStoredPublicUrl(row.photoUrl, this.photoReadTtlSec());
    return { ...row, photoUrl: url };
  }

  private staffSelect = {
    id: true,
    firstName: true,
    lastName: true,
    middleName: true,
    position: true,
    phone: true,
    cardNumber: true,
    accessKey: true,
    status: true,
    photoUrl: true,
  } as const;

  private async findStaffByCode(code: string) {
    const normalized = this.normalizeCode(code);
    if (!normalized) throw new BadRequestException(this.errors.notFound);
    const staff = await this.prisma.serviceStaff.findFirst({
      where: { OR: [{ cardNumber: normalized }, { accessKey: normalized }] },
      select: this.staffSelect,
    });
    if (!staff) throw new NotFoundException(this.errors.notFound);
    return staff;
  }

  private async findStaffById(staffId: string) {
    const id = staffId.trim();
    if (!id) throw new BadRequestException(this.errors.notFound);
    const staff = await this.prisma.serviceStaff.findUnique({
      where: { id },
      select: this.staffSelect,
    });
    if (!staff) throw new NotFoundException(this.errors.notFound);
    return staff;
  }

  private visitListOrderBy(filters: ListStaffVisitsQueryDto): Prisma.ServiceStaffVisitSessionOrderByWithRelationInput {
    const dir: Prisma.SortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc';
    const field: ListStaffVisitsSortBy | 'enteredAt' = filters.sortBy ?? 'enteredAt';
    switch (field) {
      case 'exitedAt':
        return { exitedAt: dir };
      case 'status':
        return { status: dir };
      case 'staffLastName':
        return { staff: { lastName: dir } };
      case 'enteredAt':
      default:
        return { enteredAt: dir };
    }
  }

  async lookup(params: { code?: string; staffId?: string }) {
    const code = params.code?.trim() ?? '';
    const staffId = params.staffId?.trim() ?? '';
    if (!code && !staffId) throw new BadRequestException(this.errors.notFound);
    const staff = staffId ? await this.findStaffById(staffId) : await this.findStaffByCode(code);
    const staffReadable = await this.withReadablePhotoUrl(staff);
    const openSession = await this.prisma.serviceStaffVisitSession.findFirst({
      where: { staffId: staff.id, exitedAt: null },
      orderBy: { enteredAt: 'desc' },
      select: { id: true, enteredAt: true, status: true },
    });
    return {
      staff: {
        ...staffReadable,
        fullName: [staff.lastName, staff.firstName, staff.middleName].filter(Boolean).join(' '),
      },
      inGym: Boolean(openSession),
      openSession,
    };
  }

  async checkIn(code: string, actorId: string) {
    const staff = await this.findStaffByCode(code);
    if (staff.status !== ServiceStaffStatus.ACTIVE) {
      throw new BadRequestException(this.errors.onlyActive);
    }

    let session: { id: string; enteredAt: Date };
    try {
      session = await this.prisma.$transaction(async (tx) => {
        const alreadyOpen = await tx.serviceStaffVisitSession.findFirst({
          where: { staffId: staff.id, exitedAt: null },
          select: { id: true, enteredAt: true, status: true },
        });
        if (alreadyOpen) {
          throw new BadRequestException({ ...this.errors.alreadyIn, openSession: alreadyOpen });
        }
        return tx.serviceStaffVisitSession.create({
          data: {
            staffId: staff.id,
            status: VisitSessionStatus.IN_GYM,
            enteredById: actorId,
          },
          select: { id: true, enteredAt: true },
        });
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException(this.errors.alreadyIn);
      }
      throw error;
    }

    this.logger.log(
      `AUDIT staff_visit.check_in reqId=${this.requestContext.getRequestId()} actorId=${actorId} staffId=${staff.id} sessionId=${session.id}`,
    );
    return { ok: true, action: 'CHECK_IN', session };
  }

  async checkOut(code: string, actorId: string) {
    const staff = await this.findStaffByCode(code);
    const openSession = await this.prisma.serviceStaffVisitSession.findFirst({
      where: { staffId: staff.id, exitedAt: null },
      orderBy: { enteredAt: 'desc' },
      select: { id: true },
    });
    if (!openSession) throw new BadRequestException(this.errors.notInGym);

    const session = await this.prisma.serviceStaffVisitSession.update({
      where: { id: openSession.id },
      data: {
        exitedAt: new Date(),
        exitedById: actorId,
        status: VisitSessionStatus.LEFT,
        closeReason: VisitCloseReason.NORMAL,
      },
      select: { id: true, enteredAt: true, exitedAt: true },
    });
    this.logger.log(
      `AUDIT staff_visit.check_out reqId=${this.requestContext.getRequestId()} actorId=${actorId} staffId=${staff.id} sessionId=${session.id}`,
    );
    return { ok: true, action: 'CHECK_OUT', session };
  }

  async forceClose(
    code: string,
    reason: 'LOST_KEY' | 'FOUND_LATER' | 'ADMIN_CORRECTION',
    actorId: string,
    comment?: string,
  ) {
    const staff = await this.findStaffByCode(code);
    const openSession = await this.prisma.serviceStaffVisitSession.findFirst({
      where: { staffId: staff.id, exitedAt: null },
      orderBy: { enteredAt: 'desc' },
      select: { id: true, enteredAt: true },
    });
    if (!openSession) throw new BadRequestException(this.errors.notInGym);

    const session = await this.prisma.serviceStaffVisitSession.update({
      where: { id: openSession.id },
      data: {
        exitedAt: new Date(),
        exitedById: actorId,
        status: VisitSessionStatus.FORCE_CLOSED,
        closeReason: reason,
        comment: comment?.trim() || null,
      },
      select: { id: true, enteredAt: true, exitedAt: true, closeReason: true, status: true },
    });
    this.logger.warn(
      `AUDIT staff_visit.force_close reqId=${this.requestContext.getRequestId()} actorId=${actorId} staffId=${staff.id} sessionId=${session.id} reason=${reason}`,
    );
    return { ok: true, action: 'FORCE_CLOSE', session };
  }

  async list(filters: ListStaffVisitsQueryDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;
    const search = filters.search?.trim();
    const from = filters.from ? new Date(filters.from) : null;
    let to: Date | null = null;
    if (filters.to) {
      to = new Date(filters.to);
      to.setHours(23, 59, 59, 999);
    }
    const staffId = filters.staffId?.trim();
    const state =
      filters.state === 'IN_GYM' || filters.state === 'LEFT' || filters.state === 'OVERDUE' || filters.state === 'FORCE_CLOSED'
        ? filters.state
        : undefined;

    const where: Prisma.ServiceStaffVisitSessionWhereInput = {
      staffId: staffId || undefined,
      enteredAt:
        from || to
          ? {
              gte: from ?? undefined,
              lte: to ?? undefined,
            }
          : undefined,
      status: state ? (state as VisitSessionStatus) : undefined,
      OR: search
        ? [
            { staff: { firstName: { contains: search, mode: 'insensitive' } } },
            { staff: { lastName: { contains: search, mode: 'insensitive' } } },
            { staff: { middleName: { contains: search, mode: 'insensitive' } } },
            { staff: { phone: { contains: search, mode: 'insensitive' } } },
            { staff: { cardNumber: { contains: search, mode: 'insensitive' } } },
            { staff: { position: { contains: search, mode: 'insensitive' } } },
          ]
        : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.serviceStaffVisitSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: this.visitListOrderBy(filters),
        select: {
          id: true,
          enteredAt: true,
          exitedAt: true,
          status: true,
          closeReason: true,
          comment: true,
          staff: { select: this.staffSelect },
          enteredBy: { select: { id: true, firstName: true, lastName: true, login: true } },
          exitedBy: { select: { id: true, firstName: true, lastName: true, login: true } },
        },
      }),
      this.prisma.serviceStaffVisitSession.count({ where }),
    ]);

    const itemsWithPhotos = await Promise.all(
      items.map(async (row) => ({
        ...row,
        staff: {
          ...row.staff,
          ...(await this.withReadablePhotoUrl(row.staff)),
          fullName: [row.staff.lastName, row.staff.firstName, row.staff.middleName].filter(Boolean).join(' '),
        },
      })),
    );

    return {
      items: itemsWithPhotos,
      meta: { total, page, limit },
    };
  }
}
