import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ServiceStaffStatus } from '@prisma/client';
import { CardNumberRegistryService } from '../common/card-number-registry.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateServiceStaffDto } from './dto/create-service-staff.dto';
import { ListServiceStaffQueryDto } from './dto/list-service-staff-query.dto';
import { UpdateServiceStaffDto } from './dto/update-service-staff.dto';

const STAFF_SELECT = {
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
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ServiceStaffSelect;

@Injectable()
export class ServiceStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly cardNumbers: CardNumberRegistryService,
  ) {}

  private readonly errors = {
    notFound: { code: 'SERVICE_STAFF_NOT_FOUND', message: 'Service staff not found' },
    cardExists: { code: 'CARD_NUMBER_EXISTS', message: 'Card number already exists' },
    cardRequired: { code: 'CARD_NUMBER_REQUIRED', message: 'Card number is required' },
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

  private fullName(row: { firstName: string; lastName: string; middleName?: string | null }) {
    return [row.lastName, row.firstName, row.middleName].filter(Boolean).join(' ');
  }

  async isCardNumberAvailable(cardNumber: string, excludeId?: string) {
    return this.cardNumbers.isAvailable(cardNumber, { staffId: excludeId });
  }

  private async assertCardAvailable(cardNumber: string, excludeId?: string) {
    await this.cardNumbers.assertAvailable(cardNumber, { staffId: excludeId }, this.errors.cardExists);
  }

  private async ensureExists(id: string) {
    const row = await this.prisma.serviceStaff.findUnique({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundException(this.errors.notFound);
  }

  private async attachListVisitFields<T extends { id: string }>(rows: T[]) {
    if (!rows.length) {
      return rows.map((r) => ({
        ...r,
        inGym: false,
        openVisitStatus: null as string | null,
        visitEnteredAt: null as Date | null,
        visitExitedAt: null as Date | null,
      }));
    }
    const ids = rows.map((r) => r.id);
    const open = await this.prisma.serviceStaffVisitSession.findMany({
      where: { staffId: { in: ids }, exitedAt: null },
      select: { staffId: true, status: true, enteredAt: true },
    });
    const openByStaff = new Map(open.map((s) => [s.staffId, s]));
    const withoutOpen = ids.filter((id) => !openByStaff.has(id));
    const latestByStaff = new Map<string, { enteredAt: Date; exitedAt: Date | null }>();
    if (withoutOpen.length) {
      const latest = await this.prisma.serviceStaffVisitSession.findMany({
        where: { staffId: { in: withoutOpen } },
        orderBy: { enteredAt: 'desc' },
        distinct: ['staffId'],
        select: { staffId: true, enteredAt: true, exitedAt: true },
      });
      for (const row of latest) {
        latestByStaff.set(row.staffId, { enteredAt: row.enteredAt, exitedAt: row.exitedAt });
      }
    }
    return rows.map((r) => {
      const openSession = openByStaff.get(r.id);
      if (openSession) {
        return {
          ...r,
          inGym: true,
          openVisitStatus: openSession.status,
          visitEnteredAt: openSession.enteredAt,
          visitExitedAt: null,
        };
      }
      const last = latestByStaff.get(r.id);
      return {
        ...r,
        inGym: false,
        openVisitStatus: null,
        visitEnteredAt: last?.enteredAt ?? null,
        visitExitedAt: last?.exitedAt ?? null,
      };
    });
  }

  private listOrderBy(query: ListServiceStaffQueryDto): Prisma.ServiceStaffOrderByWithRelationInput {
    const dir: Prisma.SortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
    switch (query.sortBy) {
      case 'phone':
        return { phone: dir };
      case 'cardNumber':
        return { cardNumber: dir };
      case 'position':
        return { position: dir };
      case 'status':
        return { status: dir };
      case 'createdAt':
        return { createdAt: dir };
      case 'fullName':
      default:
        return { lastName: dir };
    }
  }

  async findAll(query: ListServiceStaffQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();
    const inGym = query.inGym;

    const where: Prisma.ServiceStaffWhereInput = {
      status: query.status,
      AND: [
        search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { middleName: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
                { cardNumber: { contains: search, mode: 'insensitive' } },
                { position: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},
        inGym === 'IN_GYM'
          ? { visitSessions: { some: { exitedAt: null } } }
          : inGym === 'OUT_GYM'
            ? { visitSessions: { none: { exitedAt: null } } }
            : {},
      ],
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.serviceStaff.findMany({
        where,
        skip,
        take: limit,
        orderBy: this.listOrderBy(query),
        select: STAFF_SELECT,
      }),
      this.prisma.serviceStaff.count({ where }),
    ]);

    const withVisits = await this.attachListVisitFields(rows);
    const items = await Promise.all(
      withVisits.map(async (row) => ({
        ...row,
        fullName: this.fullName(row),
        ...(await this.withReadablePhotoUrl(row)),
      })),
    );

    return { items, meta: { total, page, limit } };
  }

  async findOne(id: string) {
    const row = await this.prisma.serviceStaff.findUnique({
      where: { id },
      select: STAFF_SELECT,
    });
    if (!row) throw new NotFoundException(this.errors.notFound);
    const [withVisits] = await this.attachListVisitFields([row]);
    const readable = await this.withReadablePhotoUrl(withVisits);
    return { ...readable, fullName: this.fullName(readable) };
  }

  async findByCardOrAccessCode(code: string) {
    const normalized = this.normalizeCode(code);
    if (!normalized) return null;
    const row = await this.prisma.serviceStaff.findFirst({
      where: { OR: [{ cardNumber: normalized }, { accessKey: normalized }] },
      select: STAFF_SELECT,
    });
    if (!row) return null;
    const [withVisits] = await this.attachListVisitFields([row]);
    const readable = await this.withReadablePhotoUrl(withVisits);
    return { ...readable, fullName: this.fullName(readable) };
  }

  async create(dto: CreateServiceStaffDto) {
    const cardNumber = this.normalizeCode(dto.cardNumber);
    if (!cardNumber) throw new BadRequestException(this.errors.cardRequired);
    await this.assertCardAvailable(cardNumber);

    const row = await this.prisma.serviceStaff.create({
      data: {
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        middleName: dto.middleName?.trim() || null,
        position: dto.position?.trim() || null,
        phone: dto.phone?.trim() || null,
        cardNumber,
        accessKey: dto.accessKey?.trim() || null,
        status: dto.status ?? ServiceStaffStatus.ACTIVE,
        notes: dto.notes?.trim() || null,
        photoUrl: dto.photoUrl?.trim() || null,
      },
      select: STAFF_SELECT,
    });
    const readable = await this.withReadablePhotoUrl(row);
    return { ...readable, fullName: this.fullName(readable), inGym: false, openVisitStatus: null };
  }

  async update(id: string, dto: UpdateServiceStaffDto) {
    await this.ensureExists(id);
    if (dto.cardNumber != null) {
      const cardNumber = this.normalizeCode(dto.cardNumber);
      if (!cardNumber) throw new BadRequestException(this.errors.cardRequired);
      await this.assertCardAvailable(cardNumber, id);
    }

    const row = await this.prisma.serviceStaff.update({
      where: { id },
      data: {
        firstName: dto.firstName?.trim(),
        lastName: dto.lastName?.trim(),
        middleName: dto.middleName === undefined ? undefined : dto.middleName?.trim() || null,
        position: dto.position === undefined ? undefined : dto.position?.trim() || null,
        phone: dto.phone === undefined ? undefined : dto.phone?.trim() || null,
        cardNumber: dto.cardNumber != null ? this.normalizeCode(dto.cardNumber) : undefined,
        accessKey: dto.accessKey === undefined ? undefined : dto.accessKey?.trim() || null,
        status: dto.status,
        notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
        photoUrl: dto.photoUrl === undefined ? undefined : dto.photoUrl?.trim() || null,
      },
      select: STAFF_SELECT,
    });
    const [withVisits] = await this.attachListVisitFields([row]);
    const readable = await this.withReadablePhotoUrl(withVisits);
    return { ...readable, fullName: this.fullName(readable) };
  }

  async remove(id: string) {
    await this.ensureExists(id);
    const open = await this.prisma.serviceStaffVisitSession.count({
      where: { staffId: id, exitedAt: null },
    });
    if (open > 0) {
      throw new BadRequestException({
        code: 'OPEN_VISIT_EXISTS',
        message: 'Cannot delete staff with open visit session',
      });
    }
    await this.prisma.serviceStaff.delete({ where: { id } });
    return { ok: true };
  }
}
