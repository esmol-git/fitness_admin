import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, VisitSessionStatus, ContractDerivedStatus, type Client, type ClientStatus } from '@prisma/client';
import { ContractsService } from '../contracts/contracts.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateClientDto } from './dto/create-client.dto';
import { PaginationDto } from './dto/pagination.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { utcTodayCalendarDayMs } from '../common/utc-calendar-day';

const CLIENT_LIST_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  middleName: true,
  phone: true,
  status: true,
  gender: true,
  birthDate: true,
  managerId: true,
  membershipType: true,
  contractStartDate: true,
  contractEndDate: true,
  cardNumber: true,
  accessKey: true,
  photoUrl: true,
} satisfies Prisma.ClientSelect;

type ClientListRow = Prisma.ClientGetPayload<{ select: typeof CLIENT_LIST_SELECT }>;

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly contracts: ContractsService,
  ) {}
  private readonly errors = {
    clientNotFound: { code: 'CLIENT_NOT_FOUND', message: 'Client not found' },
    cardNumberExists: { code: 'CARD_NUMBER_EXISTS', message: 'Card number already exists' },
    contractNumberExists: { code: 'CONTRACT_NUMBER_EXISTS', message: 'Contract number already exists' },
    cardNumberRequired: { code: 'CARD_NUMBER_REQUIRED', message: 'Card number is required' },
    photoDataUrl: {
      code: 'PHOTO_DATA_URL_NOT_ALLOWED',
      message: 'Upload via POST /clients/.../photo/upload-url (S3), do not send base64 data URLs',
    },
  } as const;

  private readonly allowedPhotoContentTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

  private photoExt(contentType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    return map[contentType] ?? 'jpg';
  }

  async presignClientPhotoUpload(clientId: string | null, contentType: string) {
    if (!this.storage.isConfigured()) {
      throw new BadRequestException({
        code: 'STORAGE_NOT_CONFIGURED',
        message: 'S3 bucket is not configured',
      });
    }
    if (!this.allowedPhotoContentTypes.has(contentType)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_IMAGE_TYPE',
        message: 'Allowed types: image/jpeg, image/png, image/webp, image/gif',
      });
    }
    const ext = this.photoExt(contentType);
    const uid = randomUUID();
    const key = clientId
      ? `clients/${clientId}/avatars/${uid}.${ext}`
      : `clients/pending/${uid}.${ext}`;
    if (clientId) {
      await this.ensureExists(clientId);
    }
    const result = await this.storage.presignPutObject(key, contentType);
    if (!result.publicUrl) {
      throw new BadRequestException({
        code: 'STORAGE_PUBLIC_URL_REQUIRED',
        message: 'Set S3_PUBLIC_BASE_URL so photo URLs are readable (e.g. public MinIO URL)',
      });
    }
    return result;
  }

  private assertNoDataUrlPhoto(photoUrl: string | null | undefined) {
    if (photoUrl == null || typeof photoUrl !== 'string') return;
    const t = photoUrl.trim();
    if (!t) return;
    if (t.toLowerCase().startsWith('data:')) {
      throw new BadRequestException(this.errors.photoDataUrl);
    }
  }

  private getTodayStart() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }

  private deriveClientStatusFromContracts(
    contracts: Array<{ derivedStatus: ContractDerivedStatus }>,
    currentClientStatus?: ClientStatus,
  ): ClientStatus {
    if (currentClientStatus === 'BLOCKED') return 'BLOCKED';
    if (contracts.length === 0) return 'INACTIVE';
    if (contracts.some((c) => c.derivedStatus === ContractDerivedStatus.ACTIVE)) return 'ACTIVE';
    if (contracts.some((c) => c.derivedStatus === ContractDerivedStatus.PAUSED)) return 'PAUSED';
    return 'INACTIVE';
  }

  private toDateOnlyString(d: Date | null | undefined): string | null {
    if (!d) return null;
    return d.toISOString().slice(0, 10);
  }

  /**
   * Для списка клиентов: окно обслуживания из активного договора (или паузы, если активных нет).
   * Если активных несколько (аномалия или переходный период), берём **последний созданный** договор —
   * иначе выбор по максимальному `serviceEndDate` подтягивал бы старый «длинный» договор вместо актуального
   * (например разового), и «дней до окончания» раздувалось бы на сотни дней.
   */
  private pickListContractServiceWindow(
    contracts: Array<{
      id: string;
      derivedStatus: ContractDerivedStatus;
      serviceStartDate: Date | null;
      serviceEndDate: Date | null;
      createdAt: Date;
    }>,
  ): { start: Date | null; end: Date | null } | null {
    const byPhase = (phase: ContractDerivedStatus) =>
      contracts.filter((c) => c.derivedStatus === phase);
    const pool =
      byPhase(ContractDerivedStatus.ACTIVE).length > 0
        ? byPhase(ContractDerivedStatus.ACTIVE)
        : byPhase(ContractDerivedStatus.PAUSED);
    if (pool.length === 0) return null;
    let best = pool[0]!;
    let bestCreated = best.createdAt.getTime();
    let bestId = best.id;
    for (const c of pool) {
      const ct = c.createdAt.getTime();
      if (ct > bestCreated || (ct === bestCreated && c.id > bestId)) {
        best = c;
        bestCreated = ct;
        bestId = c.id;
      }
    }
    if (!best.serviceEndDate) return null;
    return { start: best.serviceStartDate ?? null, end: best.serviceEndDate };
  }

  private buildFindAllWhere(query: PaginationDto): Prisma.ClientWhereInput {
    const search = query.search?.trim();
    const where: Prisma.ClientWhereInput = {};
    if (query.status && query.status !== '__ALL_STATUSES__') {
      where.status = query.status as ClientStatus;
    }
    if (query.gender && query.gender !== '__ALL_GENDERS__') {
      where.gender = query.gender;
    }
    if (query.membershipType) {
      where.membershipType = query.membershipType;
    }
    if (query.inGym === 'IN_GYM') {
      where.visitSessions = { some: { exitedAt: null, status: VisitSessionStatus.IN_GYM } };
    } else if (query.inGym === 'OUT_GYM') {
      where.visitSessions = { none: { exitedAt: null, status: VisitSessionStatus.IN_GYM } };
    } else if (query.inGym === 'VISIT_OVERDUE') {
      where.visitSessions = { some: { exitedAt: null, status: VisitSessionStatus.OVERDUE } };
    }
    if (query.lastVisitFrom || query.lastVisitTo) {
      const enteredAt: Prisma.DateTimeFilter = {};
      if (query.lastVisitFrom) {
        enteredAt.gte = new Date(query.lastVisitFrom);
      }
      if (query.lastVisitTo) {
        const end = new Date(query.lastVisitTo);
        end.setHours(23, 59, 59, 999);
        enteredAt.lte = end;
      }
      const visitRangeWhere: Prisma.ClientWhereInput = {
        visitSessions: {
          some: { enteredAt },
        },
      };
      where.AND = where.AND ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), visitRangeWhere] : [visitRangeWhere];
    }
    if (query.ageFrom || query.ageTo) {
      const today = this.getTodayStart();
      const birthDate: Prisma.DateTimeFilter = {};
      if (query.ageFrom) {
        const maxBirthDate = new Date(today);
        maxBirthDate.setFullYear(maxBirthDate.getFullYear() - query.ageFrom);
        birthDate.lte = maxBirthDate;
      }
      if (query.ageTo) {
        const minBirthDate = new Date(today);
        minBirthDate.setFullYear(minBirthDate.getFullYear() - (query.ageTo + 1));
        minBirthDate.setDate(minBirthDate.getDate() + 1);
        birthDate.gte = minBirthDate;
      }
      where.birthDate = birthDate;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { middleName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  /** Mirrors {@link buildFindAllWhere} for raw SQL (sort by open visit). */
  private buildFindAllWhereSql(query: PaginationDto): Prisma.Sql {
    const parts: Prisma.Sql[] = [];
    const search = query.search?.trim();

    if (query.status && query.status !== '__ALL_STATUSES__') {
      parts.push(Prisma.sql`c.status = ${query.status}::"ClientStatus"`);
    }
    if (query.gender && query.gender !== '__ALL_GENDERS__') {
      parts.push(Prisma.sql`c.gender = ${query.gender}::"Gender"`);
    }
    if (query.membershipType) {
      parts.push(Prisma.sql`c."membershipType" = ${query.membershipType}`);
    }
    if (query.inGym === 'IN_GYM') {
      parts.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "VisitSession" v WHERE v."clientId" = c.id AND v."exitedAt" IS NULL AND v.status = 'IN_GYM'::"VisitSessionStatus")`,
      );
    } else if (query.inGym === 'OUT_GYM') {
      parts.push(
        Prisma.sql`NOT EXISTS (SELECT 1 FROM "VisitSession" v WHERE v."clientId" = c.id AND v."exitedAt" IS NULL AND v.status = 'IN_GYM'::"VisitSessionStatus")`,
      );
    } else if (query.inGym === 'VISIT_OVERDUE') {
      parts.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "VisitSession" v WHERE v."clientId" = c.id AND v."exitedAt" IS NULL AND v.status = 'OVERDUE'::"VisitSessionStatus")`,
      );
    }
    if (query.lastVisitFrom || query.lastVisitTo) {
      if (query.lastVisitFrom && query.lastVisitTo) {
        const from = new Date(query.lastVisitFrom);
        const end = new Date(query.lastVisitTo);
        end.setHours(23, 59, 59, 999);
        parts.push(
          Prisma.sql`EXISTS (SELECT 1 FROM "VisitSession" v2 WHERE v2."clientId" = c.id AND v2."enteredAt" >= ${from} AND v2."enteredAt" <= ${end})`,
        );
      } else if (query.lastVisitFrom) {
        const from = new Date(query.lastVisitFrom);
        parts.push(
          Prisma.sql`EXISTS (SELECT 1 FROM "VisitSession" v2 WHERE v2."clientId" = c.id AND v2."enteredAt" >= ${from})`,
        );
      } else if (query.lastVisitTo) {
        const end = new Date(query.lastVisitTo);
        end.setHours(23, 59, 59, 999);
        parts.push(
          Prisma.sql`EXISTS (SELECT 1 FROM "VisitSession" v2 WHERE v2."clientId" = c.id AND v2."enteredAt" <= ${end})`,
        );
      }
    }
    if (query.ageFrom || query.ageTo) {
      const today = this.getTodayStart();
      if (query.ageFrom) {
        const maxBirthDate = new Date(today);
        maxBirthDate.setFullYear(maxBirthDate.getFullYear() - query.ageFrom);
        parts.push(Prisma.sql`c."birthDate" <= ${maxBirthDate}`);
      }
      if (query.ageTo) {
        const minBirthDate = new Date(today);
        minBirthDate.setFullYear(minBirthDate.getFullYear() - (query.ageTo + 1));
        minBirthDate.setDate(minBirthDate.getDate() + 1);
        parts.push(Prisma.sql`c."birthDate" >= ${minBirthDate}`);
      }
    }
    if (search) {
      const pattern = `%${search}%`;
      parts.push(
        Prisma.sql`(
          c.name ILIKE ${pattern}
          OR c."firstName" ILIKE ${pattern}
          OR c."lastName" ILIKE ${pattern}
          OR c."middleName" ILIKE ${pattern}
          OR c.phone ILIKE ${pattern}
          OR c.email ILIKE ${pattern}
        )`,
      );
    }

    return parts.length ? Prisma.join(parts, ' AND ') : Prisma.sql`TRUE`;
  }

  /** Незакрытая сессия: приоритет IN_GYM, иначе любой другой открытый статус (например OVERDUE). */
  private pickClientOpenVisitStatus(
    rows: Array<{ clientId: string; status: VisitSessionStatus }>,
  ): Map<string, VisitSessionStatus> {
    const map = new Map<string, VisitSessionStatus>();
    for (const r of rows) {
      if (r.status === VisitSessionStatus.IN_GYM) {
        map.set(r.clientId, VisitSessionStatus.IN_GYM);
      } else if (!map.has(r.clientId)) {
        map.set(r.clientId, r.status);
      }
    }
    return map;
  }

  private resolveClientListOrderBy(
    query: PaginationDto,
  ): Prisma.ClientOrderByWithRelationInput | Prisma.ClientOrderByWithRelationInput[] {
    const dir = query.sortOrder ?? 'asc';
    switch (query.sortBy) {
      case 'phone':
        return { phone: dir };
      case 'createdAt':
        return { createdAt: query.sortOrder ?? 'desc' };
      case 'status':
        return { status: dir };
      case 'age':
        return { birthDate: dir === 'asc' ? 'desc' : 'asc' };
      case 'fullName':
      default:
        return [{ lastName: dir }, { firstName: dir }];
    }
  }

  async findAll(query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;
    const where = this.buildFindAllWhere(query);

    let items: ClientListRow[];
    let total: number;

    if (query.sortBy === 'inGym') {
      const whereSql = this.buildFindAllWhereSql(query);
      const dirDesc = (query.sortOrder ?? 'desc') === 'desc';
      const [totalResult, idRows] = await this.prisma.$transaction([
        this.prisma.client.count({ where }),
        dirDesc
          ? this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
              SELECT c.id FROM "Client" c
              WHERE ${whereSql}
              ORDER BY (EXISTS (
                SELECT 1 FROM "VisitSession" vi WHERE vi."clientId" = c.id AND vi."exitedAt" IS NULL AND vi.status = 'IN_GYM'::"VisitSessionStatus"
              )) DESC,
              c."lastName" ASC,
              c."firstName" ASC
              LIMIT ${limit} OFFSET ${skip}
            `)
          : this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
              SELECT c.id FROM "Client" c
              WHERE ${whereSql}
              ORDER BY (EXISTS (
                SELECT 1 FROM "VisitSession" vi WHERE vi."clientId" = c.id AND vi."exitedAt" IS NULL AND vi.status = 'IN_GYM'::"VisitSessionStatus"
              )) ASC,
              c."lastName" ASC,
              c."firstName" ASC
              LIMIT ${limit} OFFSET ${skip}
            `),
      ]);
      total = totalResult;
      const ids = idRows.map((r) => r.id);
      if (ids.length === 0) {
        items = [];
      } else {
        const unordered = await this.prisma.client.findMany({
          where: { id: { in: ids } },
          select: CLIENT_LIST_SELECT,
        });
        const orderMap = new Map(ids.map((id, index) => [id, index]));
        items = [...unordered].sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
      }
    } else if (query.sortBy === 'lastVisitAt') {
      const whereSql = this.buildFindAllWhereSql(query);
      const dirDesc = (query.sortOrder ?? 'desc') === 'desc';
      const [totalResult, idRows] = await this.prisma.$transaction([
        this.prisma.client.count({ where }),
        dirDesc
          ? this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
              SELECT c.id FROM "Client" c
              WHERE ${whereSql}
              ORDER BY (
                SELECT MAX(v."enteredAt") FROM "VisitSession" v WHERE v."clientId" = c.id
              ) DESC NULLS LAST,
              c."lastName" ASC,
              c."firstName" ASC
              LIMIT ${limit} OFFSET ${skip}
            `)
          : this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
              SELECT c.id FROM "Client" c
              WHERE ${whereSql}
              ORDER BY (
                SELECT MAX(v."enteredAt") FROM "VisitSession" v WHERE v."clientId" = c.id
              ) ASC NULLS LAST,
              c."lastName" ASC,
              c."firstName" ASC
              LIMIT ${limit} OFFSET ${skip}
            `),
      ]);
      total = totalResult;
      const ids = idRows.map((r) => r.id);
      if (ids.length === 0) {
        items = [];
      } else {
        const unordered = await this.prisma.client.findMany({
          where: { id: { in: ids } },
          select: CLIENT_LIST_SELECT,
        });
        const orderMap = new Map(ids.map((id, index) => [id, index]));
        items = [...unordered].sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
      }
    } else {
      const [rows, countResult] = await this.prisma.$transaction([
        this.prisma.client.findMany({
          where,
          skip,
          take: limit,
          orderBy: this.resolveClientListOrderBy(query),
          select: CLIENT_LIST_SELECT,
        }),
        this.prisma.client.count({ where }),
      ]);
      items = rows;
      total = countResult;
    }

    if (items.length > 0) {
      const contractRows = await this.prisma.contractDocument.findMany({
        where: { clientId: { in: items.map((item) => item.id) } },
        select: {
          id: true,
          clientId: true,
          derivedStatus: true,
          serviceStartDate: true,
          serviceEndDate: true,
          createdAt: true,
        },
      });
      const [openVisitRows, latestVisitRows] = await this.prisma.$transaction([
        this.prisma.visitSession.findMany({
          where: {
            clientId: { in: items.map((item) => item.id) },
            exitedAt: null,
          },
          select: { clientId: true, status: true },
        }),
        this.prisma.visitSession.findMany({
          where: { clientId: { in: items.map((item) => item.id) } },
          orderBy: [{ clientId: 'asc' }, { enteredAt: 'desc' }],
          distinct: ['clientId'],
          select: { clientId: true, enteredAt: true },
        }),
      ]);
      const byClient = new Map<
        string,
        Array<{
          id: string;
          clientId: string;
          derivedStatus: ContractDerivedStatus;
          serviceStartDate: Date | null;
          serviceEndDate: Date | null;
          createdAt: Date;
        }>
      >();
      for (const row of contractRows) {
        const list = byClient.get(row.clientId) ?? [];
        list.push(row);
        byClient.set(row.clientId, list);
      }
      const openVisitByClient = this.pickClientOpenVisitStatus(openVisitRows);
      const latestVisitByClient = new Map(latestVisitRows.map((row) => [row.clientId, row.enteredAt]));
      for (const item of items) {
        const openSt = openVisitByClient.get(item.id);
        const row = item as typeof item & {
          inGym?: boolean;
          openVisitStatus?: VisitSessionStatus | null;
          lastVisitAt?: Date | null;
        };
        row.inGym = openSt === VisitSessionStatus.IN_GYM;
        row.openVisitStatus = openSt ?? null;
        row.lastVisitAt = latestVisitByClient.get(item.id) ?? null;
        if (item.status !== 'BLOCKED') {
          const displayStatus = this.deriveClientStatusFromContracts(
            byClient.get(item.id) ?? [],
            item.status,
          );
          item.status = displayStatus;
        }
        const contracts = byClient.get(item.id) ?? [];
        const picked = this.pickListContractServiceWindow(contracts);
        const contractRow = item as Client & {
          effectiveContractStartDate?: string | null;
          effectiveContractEndDate?: string | null;
        };
        if (picked?.end) {
          contractRow.effectiveContractEndDate = this.toDateOnlyString(picked.end);
          contractRow.effectiveContractStartDate =
            this.toDateOnlyString(picked.start) ?? this.toDateOnlyString(item.contractStartDate);
        } else {
          contractRow.effectiveContractStartDate = this.toDateOnlyString(item.contractStartDate);
          contractRow.effectiveContractEndDate = this.toDateOnlyString(item.contractEndDate);
        }
      }
    }

    if (items.length > 0) {
      const catalogIds = [
        ...new Set(
          items
            .map((i) => i.membershipType)
            .filter((id): id is string => Boolean(id?.trim())),
        ),
      ];
      if (catalogIds.length > 0) {
        const catalogRows = await this.prisma.membershipCatalog.findMany({
          where: { id: { in: catalogIds } },
          select: { id: true, name: true },
        });
        const nameById = new Map(catalogRows.map((c) => [c.id, c.name]));
        for (const item of items) {
          const id = item.membershipType?.trim();
          if (!id) continue;
          const row = item as typeof item & { membershipCatalogName?: string | null };
          row.membershipCatalogName = nameById.get(id) ?? null;
        }
      }
    }

    const itemsWithPhoto = await this.withReadablePhotoUrls(items);
    return { items: itemsWithPhoto, total };
  }

  async create(dto: CreateClientDto, actorId: string) {
    this.assertNoDataUrlPhoto(dto.photoUrl);
    const data = this.mapCreateData(dto, actorId);
    try {
      const created = await this.prisma.client.create({ data });
      return this.withReadablePhotoUrl(created);
    } catch (error: unknown) {
      this.rethrowKnownConflict(error);
      throw error;
    }
  }

  async findOne(id: string) {
    await this.contracts.syncClientSnapshotFromContracts(id);
    const item = await this.prisma.client.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(this.errors.clientNotFound);
    return this.withReadablePhotoUrl(item);
  }

  async findByCardOrAccessCode(code: string) {
    const normalized = code.trim();
    if (!normalized) return null;
    const row = await this.prisma.client.findFirst({
      where: {
        OR: [{ cardNumber: normalized }, { accessKey: normalized }],
      },
    });
    if (!row) return null;
    await this.contracts.syncClientSnapshotFromContracts(row.id);
    const fresh = await this.prisma.client.findUnique({ where: { id: row.id } });
    if (!fresh) return null;
    return this.withReadablePhotoUrl(fresh);
  }

  async isCardNumberAvailable(cardNumber: string, excludeId?: string) {
    const normalized = cardNumber.trim();
    if (!normalized) return true;
    const item = await this.prisma.client.findUnique({
      where: { cardNumber: normalized },
      select: { id: true },
    });
    if (!item) return true;
    return excludeId ? item.id === excludeId : false;
  }

  async update(id: string, dto: UpdateClientDto, actorId: string) {
    if (dto.photoUrl !== undefined) {
      this.assertNoDataUrlPhoto(dto.photoUrl);
    }
    const existing = await this.prisma.client.findUnique({
      where: { id },
      select: { id: true, firstName: true, lastName: true, middleName: true },
    });
    if (!existing) throw new NotFoundException(this.errors.clientNotFound);
    const data = this.mapUpdateData(dto, existing, actorId);
    try {
      const updated = await this.prisma.client.update({ where: { id }, data });
      await this.contracts.syncClientSnapshotFromContracts(id);
      const synced = await this.prisma.client.findUnique({ where: { id } });
      return this.withReadablePhotoUrl(synced ?? updated);
    } catch (error: unknown) {
      this.rethrowKnownConflict(error);
      throw error;
    }
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.client.delete({ where: { id } });
    return { ok: true };
  }

  async block(id: string) {
    await this.ensureExists(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.contractDocument.updateMany({
        where: {
          clientId: id,
          status: { in: ['ACTIVE', 'PAUSED', 'SAVED'] },
        },
        data: { status: 'CANCELLED' },
      });
      await tx.visitSession.updateMany({
        where: { clientId: id, exitedAt: null },
        data: {
          exitedAt: new Date(),
          status: 'FORCE_CLOSED',
          closeReason: 'BLOCKED',
          comment: 'Closed due to client blocking',
        },
      });
      await tx.client.update({
        where: { id },
        data: { status: 'BLOCKED' },
      });
    });
    return this.findOne(id);
  }

  async unblock(id: string) {
    await this.ensureExists(id);
    await this.prisma.client.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });
    return this.findOne(id);
  }

  async addressSuggestions(query: string) {
    const normalized = query.trim();
    if (normalized.length < 3) return [];

    const apiKey = this.config.get<string>('DADATA_API_KEY')?.trim();
    if (!apiKey) return [];

    const endpoint =
      this.config.get<string>('DADATA_ADDRESS_SUGGEST_URL') ??
      'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Token ${apiKey}`,
        },
        body: JSON.stringify({
          query: normalized,
          count: 7,
        }),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as {
        suggestions?: Array<{ value?: string | null }>;
      };
      return (data.suggestions ?? [])
        .map((item) => item.value?.trim() ?? '')
        .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index)
        .slice(0, 7);
    } catch {
      return [];
    }
  }

  private async ensureExists(id: string) {
    const item = await this.prisma.client.findUnique({ where: { id }, select: { id: true } });
    if (!item) throw new NotFoundException(this.errors.clientNotFound);
  }

  private composeName(lastName: string, firstName: string, middleName?: string | null) {
    return [lastName, firstName, middleName].filter((v) => typeof v === 'string' && v.trim().length > 0).join(' ');
  }

  private nullable(value?: string | null) {
    if (value == null) return null;
    const next = value.trim();
    return next.length > 0 ? next : null;
  }

  /** Убирает query (presigned GET), чтобы в БД хранился стабильный URL объекта. */
  private normalizePhotoUrlForStorage(url: string | null | undefined): string | null {
    const n = this.nullable(url);
    if (!n) return null;
    const key = this.storage.extractObjectKeyFromPublicUrl(n);
    if (!key) return n;
    const base = this.config.get<string>('S3_PUBLIC_BASE_URL')?.trim().replace(/\/+$/, '') ?? '';
    if (!base) return n;
    return `${base}/${key}`;
  }

  /** TTL подписанного GET для photoUrl (приватный MinIO). По умолчанию 7 суток. */
  private photoReadTtlSec() {
    const v = Number(this.config.get('S3_PHOTO_READ_TTL_SEC'));
    return Number.isFinite(v) && v >= 60 ? Math.floor(v) : 604800;
  }

  private async withReadablePhotoUrl<T extends { photoUrl: string | null }>(row: T): Promise<T> {
    if (!row.photoUrl?.trim()) return row;
    const url = await this.storage.presignGetUrlForStoredPublicUrl(row.photoUrl, this.photoReadTtlSec());
    return { ...row, photoUrl: url };
  }

  private async withReadablePhotoUrls<T extends { photoUrl: string | null }>(rows: T[]): Promise<T[]> {
    return Promise.all(rows.map((r) => this.withReadablePhotoUrl(r)));
  }

  private requiredTrimmed(value: string | undefined, fieldLabel: string) {
    const next = value?.trim() ?? '';
    if (!next) {
      if (fieldLabel === 'Card number') throw new BadRequestException(this.errors.cardNumberRequired);
      throw new BadRequestException({ code: 'FIELD_REQUIRED', message: `${fieldLabel} is required` });
    }
    return next;
  }

  private parseDate(value?: string | null) {
    if (!value) return null;
    return new Date(value);
  }

  private rethrowKnownConflict(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const target = Array.isArray(error.meta?.target) ? error.meta.target : [];
      if (target.includes('cardNumber')) {
        throw new ConflictException(this.errors.cardNumberExists);
      }
      if (target.includes('contractNumber')) {
        throw new ConflictException(this.errors.contractNumberExists);
      }
    }
  }

  private mapCreateData(dto: CreateClientDto, actorId: string): Prisma.ClientCreateInput {
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const middleName = this.nullable(dto.middleName);
    return {
      firstName,
      lastName,
      middleName,
      name: this.composeName(lastName, firstName, middleName),
      phone: dto.phone.trim(),
      birthDate: this.parseDate(dto.birthDate),
      gender: dto.gender ?? null,
      status: 'INACTIVE',
      email: this.nullable(dto.email),
      passport: this.nullable(dto.passport),
      passportIssuedBy: this.nullable(dto.passportIssuedBy),
      passportIssuedAt: this.parseDate(dto.passportIssuedAt),
      address: this.nullable(dto.address),
      notes: this.nullable(dto.notes),
      manager: { connect: { id: actorId } },
      contractNumber: this.nullable(dto.contractNumber),
      contractStartDate: this.parseDate(dto.contractStartDate),
      contractEndDate: this.parseDate(dto.contractEndDate),
      paymentDate: this.parseDate(dto.paymentDate),
      membershipType: this.nullable(dto.membershipType),
      cardNumber: this.requiredTrimmed(dto.cardNumber, 'Card number'),
      accessKey: this.nullable(dto.accessKey),
      photoUrl: this.normalizePhotoUrlForStorage(dto.photoUrl),
    };
  }

  private mapUpdateData(
    dto: UpdateClientDto,
    existing: { firstName: string; lastName: string; middleName: string | null },
    actorId: string,
  ): Prisma.ClientUpdateInput {
    const data: Prisma.ClientUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) data.lastName = dto.lastName.trim();
    if (dto.middleName !== undefined) data.middleName = this.nullable(dto.middleName);
    if (dto.phone !== undefined) data.phone = dto.phone.trim();
    if (dto.birthDate !== undefined) data.birthDate = this.parseDate(dto.birthDate);
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.email !== undefined) data.email = this.nullable(dto.email);
    if (dto.passport !== undefined) data.passport = this.nullable(dto.passport);
    if (dto.passportIssuedBy !== undefined) data.passportIssuedBy = this.nullable(dto.passportIssuedBy);
    if (dto.passportIssuedAt !== undefined) data.passportIssuedAt = this.parseDate(dto.passportIssuedAt);
    if (dto.address !== undefined) data.address = this.nullable(dto.address);
    if (dto.notes !== undefined) data.notes = this.nullable(dto.notes);
    data.manager = { connect: { id: actorId } };
    if (dto.contractNumber !== undefined) data.contractNumber = this.nullable(dto.contractNumber);
    if (dto.contractStartDate !== undefined) data.contractStartDate = this.parseDate(dto.contractStartDate);
    if (dto.contractEndDate !== undefined) data.contractEndDate = this.parseDate(dto.contractEndDate);
    if (dto.paymentDate !== undefined) data.paymentDate = this.parseDate(dto.paymentDate);
    if (dto.membershipType !== undefined) data.membershipType = this.nullable(dto.membershipType);
    if (dto.cardNumber !== undefined) data.cardNumber = this.nullable(dto.cardNumber);
    if (dto.accessKey !== undefined) data.accessKey = this.nullable(dto.accessKey);
    if (dto.photoUrl !== undefined) data.photoUrl = this.normalizePhotoUrlForStorage(dto.photoUrl);

    const nextFirst = dto.firstName?.trim() ?? existing.firstName;
    const nextLast = dto.lastName?.trim() ?? existing.lastName;
    const nextMiddle =
      dto.middleName !== undefined ? this.nullable(dto.middleName) : existing.middleName;
    data.name = this.composeName(nextLast, nextFirst, nextMiddle).trim();
    return data;
  }
}
