import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientStatus, Prisma, VisitCloseReason, VisitSessionStatus } from '@prisma/client';
import { normalizeLockerNumber } from '../common/locker-number';
import { RequestContextService } from '../common/request-context.service';
import { ContractsService } from '../contracts/contracts.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { type ListVisitsSortBy, ListVisitsQueryDto } from './dto/list-visits-query.dto';

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly contracts: ContractsService,
  ) {}
  private readonly logger = new Logger(VisitsService.name);

  private visitListOrderBy(filters: ListVisitsQueryDto): Prisma.VisitSessionOrderByWithRelationInput {
    const dir: Prisma.SortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc';
    const field: ListVisitsSortBy | 'enteredAt' = filters.sortBy ?? 'enteredAt';
    switch (field) {
      case 'exitedAt':
        return { exitedAt: dir };
      case 'lockerNumber':
        return { lockerNumber: dir };
      case 'status':
        return { status: dir };
      case 'clientLastName':
        return { client: { lastName: dir } };
      case 'clientPhone':
        return { client: { phone: dir } };
      case 'enteredAt':
      default:
        return { enteredAt: dir };
    }
  }

  private readonly errors = {
    clientNotFound: { code: 'CLIENT_NOT_FOUND', message: 'Client not found' },
    onlyActiveAllowed: { code: 'ONLY_ACTIVE_ALLOWED', message: 'Only active clients can enter gym' },
    alreadyInGym: { code: 'OPEN_VISIT_EXISTS', message: 'Client already has open visit session' },
    notInGym: { code: 'NOT_IN_GYM', message: 'Client is not in gym' },
    lockerBusy: { code: 'LOCKER_BUSY', message: 'Locker is already occupied' },
    lockerRequired: { code: 'LOCKER_REQUIRED', message: 'Locker number is required' },
  } as const;

  private normalizeCode(value: string) {
    return value.trim();
  }

  /** TTL подписанного GET для photoUrl (приватный MinIO). Совпадает с ClientsService. */
  private photoReadTtlSec() {
    const v = Number(this.config.get('S3_PHOTO_READ_TTL_SEC'));
    return Number.isFinite(v) && v >= 60 ? Math.floor(v) : 604800;
  }

  private async withReadablePhotoUrl<T extends { photoUrl: string | null }>(row: T): Promise<T> {
    if (!row.photoUrl?.trim()) return row;
    const url = await this.storage.presignGetUrlForStoredPublicUrl(row.photoUrl, this.photoReadTtlSec());
    return { ...row, photoUrl: url };
  }

  private async findClientById(clientId: string) {
    const id = clientId.trim();
    if (!id) throw new BadRequestException(this.errors.clientNotFound);
    const client = await this.prisma.client.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        middleName: true,
        phone: true,
        cardNumber: true,
        accessKey: true,
        lockerNumber: true,
        status: true,
        photoUrl: true,
      },
    });
    if (!client) throw new NotFoundException(this.errors.clientNotFound);
    return client;
  }

  private async findClientByCode(code: string) {
    const normalized = this.normalizeCode(code);
    if (!normalized) throw new BadRequestException(this.errors.clientNotFound);
    const client = await this.prisma.client.findFirst({
      where: { OR: [{ cardNumber: normalized }, { accessKey: normalized }] },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        middleName: true,
        phone: true,
        cardNumber: true,
        accessKey: true,
        lockerNumber: true,
        status: true,
        photoUrl: true,
      },
    });
    if (!client) throw new NotFoundException(this.errors.clientNotFound);
    return client;
  }

  private async buildLookupResponse(client: {
    id: string;
    firstName: string;
    lastName: string;
    middleName: string | null;
    phone: string;
    cardNumber: string | null;
    accessKey: string | null;
    lockerNumber: string | null;
    status: ClientStatus;
    photoUrl: string | null;
  }) {
    const clientReadable = await this.withReadablePhotoUrl(client);
    const contractUnpaid = await this.contracts.getPrimaryContractUnpaidSummaryForVisitLookup(client.id);
    const openSession = await this.prisma.visitSession.findFirst({
      where: { clientId: client.id, exitedAt: null },
      orderBy: { enteredAt: 'desc' },
      select: { id: true, lockerNumber: true, enteredAt: true, status: true },
    });
    return {
      client: {
        ...clientReadable,
        fullName: [client.lastName, client.firstName, client.middleName].filter(Boolean).join(' '),
        contractUnpaid,
      },
      inGym: Boolean(openSession),
      openSession,
    };
  }

  async lookup(params: { code?: string; clientId?: string }) {
    const code = params.code?.trim() ?? '';
    const clientId = params.clientId?.trim() ?? '';
    if (!code && !clientId) throw new BadRequestException(this.errors.clientNotFound);
    const client = clientId ? await this.findClientById(clientId) : await this.findClientByCode(code);
    return this.buildLookupResponse(client);
  }

  async checkIn(code: string, lockerNumber: string, actorId: string) {
    const client = await this.findClientByCode(code);
    if (client.status !== ClientStatus.ACTIVE) throw new BadRequestException(this.errors.onlyActiveAllowed);
    const locker = normalizeLockerNumber(lockerNumber);
    if (!locker) throw new BadRequestException(this.errors.lockerRequired);

    let session: { id: string; lockerNumber: string; enteredAt: Date };
    try {
      session = await this.prisma.$transaction(async (tx) => {
        const alreadyOpen = await tx.visitSession.findFirst({
          where: { clientId: client.id, exitedAt: null },
          select: { id: true, lockerNumber: true, enteredAt: true, status: true },
        });
        if (alreadyOpen) {
          throw new BadRequestException({
            ...this.errors.alreadyInGym,
            openSession: alreadyOpen,
          });
        }
        const lockerOpen = await tx.visitSession.findFirst({
          where: { lockerNumber: locker, exitedAt: null },
          select: { id: true, clientId: true },
        });
        if (lockerOpen) throw new BadRequestException(this.errors.lockerBusy);

        const lockerAssigned = await tx.client.findFirst({
          where: { lockerNumber: locker, NOT: { id: client.id } },
          select: { id: true },
        });
        if (lockerAssigned) throw new BadRequestException(this.errors.lockerBusy);

        const enteredAt = new Date();
        await tx.client.update({
          where: { id: client.id },
          data: { lockerNumber: locker },
        });
        return tx.visitSession.create({
          data: {
            clientId: client.id,
            lockerNumber: locker,
            enteredAt,
            status: VisitSessionStatus.IN_GYM,
            enteredById: actorId,
          },
          select: { id: true, lockerNumber: true, enteredAt: true },
        });
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = error.meta?.target;
        const fields = Array.isArray(target) ? target.map(String) : [];
        if (fields.includes('clientId')) {
          throw new BadRequestException(this.errors.alreadyInGym);
        }
        if (fields.includes('lockerNumber')) {
          throw new BadRequestException(this.errors.lockerBusy);
        }
      }
      throw error;
    }

    this.logger.log(
      `AUDIT visit.check_in reqId=${this.requestContext.getRequestId()} actorId=${actorId} clientId=${client.id} sessionId=${session.id} locker=${session.lockerNumber}`,
    );
    return { ok: true, action: 'CHECK_IN', session };
  }

  async checkOut(code: string, actorId: string) {
    const client = await this.findClientByCode(code);
    const openSession = await this.prisma.visitSession.findFirst({
      where: { clientId: client.id, exitedAt: null },
      orderBy: { enteredAt: 'desc' },
      select: { id: true },
    });
    if (!openSession) throw new BadRequestException(this.errors.notInGym);

    const session = await this.prisma.visitSession.update({
      where: { id: openSession.id },
      data: {
        exitedAt: new Date(),
        exitedById: actorId,
        status: VisitSessionStatus.LEFT,
        closeReason: VisitCloseReason.NORMAL,
      },
      select: { id: true, lockerNumber: true, enteredAt: true, exitedAt: true },
    });
    this.logger.log(
      `AUDIT visit.check_out reqId=${this.requestContext.getRequestId()} actorId=${actorId} clientId=${client.id} sessionId=${session.id}`,
    );
    return { ok: true, action: 'CHECK_OUT', session };
  }

  async forceClose(code: string, reason: 'LOST_KEY' | 'FOUND_LATER' | 'ADMIN_CORRECTION', actorId: string, comment?: string) {
    const client = await this.findClientByCode(code);
    const openSession = await this.prisma.visitSession.findFirst({
      where: { clientId: client.id, exitedAt: null },
      orderBy: { enteredAt: 'desc' },
      select: { id: true, lockerNumber: true, enteredAt: true },
    });
    if (!openSession) throw new BadRequestException(this.errors.notInGym);

    const session = await this.prisma.visitSession.update({
      where: { id: openSession.id },
      data: {
        exitedAt: new Date(),
        exitedById: actorId,
        status: VisitSessionStatus.FORCE_CLOSED,
        closeReason: reason,
        comment: comment?.trim() || null,
      },
      select: { id: true, lockerNumber: true, enteredAt: true, exitedAt: true, closeReason: true, status: true },
    });
    this.logger.warn(
      `AUDIT visit.force_close reqId=${this.requestContext.getRequestId()} actorId=${actorId} clientId=${client.id} sessionId=${session.id} reason=${reason}`,
    );
    return { ok: true, action: 'FORCE_CLOSE', session };
  }

  async listCurrent() {
    return this.prisma.visitSession.findMany({
      where: { exitedAt: null },
      orderBy: { enteredAt: 'asc' },
      select: {
        id: true,
        lockerNumber: true,
        enteredAt: true,
        status: true,
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            middleName: true,
            gender: true,
            birthDate: true,
            status: true,
            membershipType: true,
            phone: true,
            cardNumber: true,
          },
        },
      },
    });
  }

  async list(filters: ListVisitsQueryDto) {
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
    const clientId = filters.clientId?.trim();
    const state =
      filters.state === 'IN_GYM' || filters.state === 'LEFT' || filters.state === 'OVERDUE' || filters.state === 'FORCE_CLOSED'
        ? filters.state
        : undefined;

    const where: Prisma.VisitSessionWhereInput = {
      clientId: clientId || undefined,
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
            { lockerNumber: { contains: search, mode: 'insensitive' } },
            { client: { firstName: { contains: search, mode: 'insensitive' } } },
            { client: { lastName: { contains: search, mode: 'insensitive' } } },
            { client: { middleName: { contains: search, mode: 'insensitive' } } },
            { client: { phone: { contains: search, mode: 'insensitive' } } },
            { client: { cardNumber: { contains: search, mode: 'insensitive' } } },
          ]
        : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.visitSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: this.visitListOrderBy(filters),
        select: {
          id: true,
          lockerNumber: true,
          enteredAt: true,
          exitedAt: true,
          status: true,
          closeReason: true,
          comment: true,
          client: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              middleName: true,
              gender: true,
              birthDate: true,
              status: true,
              membershipType: true,
              phone: true,
              cardNumber: true,
              photoUrl: true,
            },
          },
          enteredBy: { select: { id: true, firstName: true, lastName: true, login: true } },
          exitedBy: { select: { id: true, firstName: true, lastName: true, login: true } },
        },
      }),
      this.prisma.visitSession.count({ where }),
    ]);

    const itemsWithPhotos = await Promise.all(
      items.map(async (row) => ({
        ...row,
        client: await this.withReadablePhotoUrl({
          ...row.client,
          photoUrl: row.client.photoUrl,
        }),
      })),
    );

    return {
      items: itemsWithPhotos,
      meta: { total, page, limit },
    };
  }
}
