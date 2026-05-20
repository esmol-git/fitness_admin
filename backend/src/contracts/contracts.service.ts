import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  ClientStatus,
  ContractDerivedStatus,
  PaymentChannel,
  PaymentOperationType,
  PaymentStatus,
  Prisma,
  RefundMethod,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../common/request-context.service';
import {
  addCalendarDurationUtc,
  diffDaysInclusiveUtc,
  isoYmdFromUtcDate,
  utcCalendarDayMs,
  utcDateFromIsoYmd,
  utcTodayCalendarDayMs,
  utcTodayStartDate,
} from '../common/utc-calendar-day';
import {
  deriveContractDerivedStatus,
} from '../common/contract-derived-status';
import { StorageService } from '../storage/storage.service';
import { PDFDocument, PDFDropdown, PDFOptionList, PDFTextField } from 'pdf-lib';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ActivateContractDto } from './dto/activate-contract.dto';
import { CancelContractDto } from './dto/cancel-contract.dto';
import { FreezeContractDto } from './dto/freeze-contract.dto';
import { GenerateContractDto } from './dto/generate-contract.dto';

function formatRuDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function normalizeFieldName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[_-]/g, '');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

@Injectable()
export class ContractsService implements OnModuleInit {
  private readonly logger = new Logger(ContractsService.name);
  private static readonly FREEZE_MIN_DAYS = 1;
  private readonly errors = {
    invalidDateFilter: { code: 'INVALID_DATE_FILTER', message: 'Invalid date filter' },
    invalidDateRange: { code: 'INVALID_DATE_RANGE', message: 'Invalid date range' },
    cannotPauseFinished: { code: 'CANNOT_PAUSE_FINISHED_CONTRACT', message: 'Cannot pause finished contract' },
    onlyPausedCanResume: { code: 'ONLY_PAUSED_CAN_RESUME', message: 'Only paused contract can be resumed' },
    activeContractExists: { code: 'ACTIVE_CONTRACT_EXISTS', message: 'Active contract already exists for this client' },
    activeMembershipBlocksActivate: {
      code: 'ACTIVE_MEMBERSHIP_BLOCKS_ACTIVATE',
      message: 'The next contract can start only after the current membership has ended (pause does not count as ended)',
    },
    onlySavedCanActivate: {
      code: 'ONLY_SAVED_CAN_ACTIVATE',
      message: 'Only a pending contract can be started',
    },
    serviceStartRequired: {
      code: 'SERVICE_START_REQUIRED',
      message: 'Service start date is required to activate the contract',
    },
    serviceEndRequired: {
      code: 'SERVICE_END_REQUIRED',
      message: 'Service end date could not be determined from membership duration',
    },
    contractNumberExists: { code: 'CONTRACT_NUMBER_EXISTS', message: 'Contract number already exists' },
    contractNumberRequired: { code: 'CONTRACT_NUMBER_REQUIRED', message: 'Contract number is required' },
    servicePriceRequired: { code: 'SERVICE_PRICE_REQUIRED', message: 'Service price is required' },
    paymentAmountRequired: { code: 'PAYMENT_AMOUNT_REQUIRED', message: 'Payment amount is required' },
    paymentAmountExceedsPrice: {
      code: 'PAYMENT_AMOUNT_EXCEEDS_PRICE',
      message: 'Payment amount cannot exceed service price',
    },
    serviceDateRangeInvalid: { code: 'SERVICE_DATE_RANGE_INVALID', message: 'Service end date must be after service start date' },
    freezeOutOfRange: { code: 'FREEZE_OUT_OF_CONTRACT_RANGE', message: 'Freeze must be within contract dates' },
    freezeDurationInvalid: { code: 'FREEZE_DURATION_INVALID', message: 'Freeze duration must be at least 1 day' },
    freezeOverlaps: { code: 'FREEZE_OVERLAPS', message: 'Freeze overlaps existing freeze period' },
    onlyActiveCanFreeze: { code: 'ONLY_ACTIVE_CAN_FREEZE', message: 'Only active contract can be frozen' },
    refundExceedsPaid: { code: 'REFUND_LIMIT_EXCEEDED', message: 'Refund exceeds paid amount' },
    refundMethodRequired: { code: 'REFUND_METHOD_REQUIRED', message: 'Refund method is required for positive refund' },
    installmentInitialRequired: {
      code: 'INSTALLMENT_INITIAL_REQUIRED',
      message: 'Initial payment amount is required for installment plan',
    },
    installmentInitialInvalid: {
      code: 'INSTALLMENT_INITIAL_INVALID',
      message: 'Initial payment must be greater than zero and not exceed contract price',
    },
    installmentCountInvalid: {
      code: 'INSTALLMENT_COUNT_INVALID',
      message: 'Installment count must be an integer from 2 to 120',
    },
  } as const;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly requestContext: RequestContextService,
  ) {}

  onModuleInit() {
    void this.runStartupStatusSync().catch((err) => {
      this.logger.error('Startup contracts statuses sync failed', err);
    });
  }

  /** После деплоя / рестарта: даты и derivedStatus без массового refresh Client.status. */
  private async runStartupStatusSync() {
    await this.ensureCalendarDayContractState();
    await this.syncDerivedStatuses();
  }

  /** Истечение по датам и окончание заморозок — без полного пересчёта derivedStatus. */
  private async ensureCalendarDayContractState() {
    await this.syncExpiredFreezes();
    await this.syncExpiredContracts();
  }

  private toDate(value?: string) {
    return utcDateFromIsoYmd(value);
  }

  private toPrice(value?: string) {
    if (!value) return null;
    const normalized = value.replace(',', '.').trim();
    if (!normalized) return null;
    const num = Number(normalized);
    if (!Number.isFinite(num)) return null;
    return new Prisma.Decimal(num.toFixed(2));
  }

  private async aggregateNetPaidByContractIds(contractIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    const map = new Map<string, Prisma.Decimal>();
    if (contractIds.length === 0) return map;
    for (const id of contractIds) {
      map.set(id, new Prisma.Decimal(0));
    }
    const [sales, refunds] = await Promise.all([
      this.prisma.payment.groupBy({
        by: ['contractDocumentId'],
        where: {
          contractDocumentId: { in: contractIds },
          operationType: PaymentOperationType.SALE,
          status: PaymentStatus.PAID,
        },
        _sum: { amount: true },
      }),
      this.prisma.payment.groupBy({
        by: ['contractDocumentId'],
        where: {
          contractDocumentId: { in: contractIds },
          operationType: PaymentOperationType.REFUND,
          status: PaymentStatus.REFUNDED,
        },
        _sum: { amount: true },
      }),
    ]);
    for (const s of sales) {
      if (!s.contractDocumentId) continue;
      const cur = map.get(s.contractDocumentId) ?? new Prisma.Decimal(0);
      map.set(s.contractDocumentId, cur.plus(s._sum.amount ?? 0));
    }
    for (const r of refunds) {
      if (!r.contractDocumentId) continue;
      const cur = map.get(r.contractDocumentId) ?? new Prisma.Decimal(0);
      map.set(r.contractDocumentId, cur.minus(r._sum.amount ?? 0));
    }
    return map;
  }

  private resolveContractSigningPayment(
    dto: GenerateContractDto,
    servicePrice: Prisma.Decimal,
  ): {
    paymentAmount: Prisma.Decimal;
    paymentPlan: 'FULL' | 'INSTALLMENT_FLEXIBLE' | 'INSTALLMENT_EQUAL';
    installmentCount: number | undefined;
    channel: PaymentChannel;
  } {
    const rawPlan = dto.paymentPlan;
    const isLegacyInstallment = rawPlan === 'INSTALLMENT_FLEXIBLE' || rawPlan === 'INSTALLMENT_EQUAL';
    if (isLegacyInstallment && !dto.paymentAmount?.trim() && dto.initialPaymentAmount?.trim()) {
      const initialParsed = this.toPrice(dto.initialPaymentAmount);
      if (!initialParsed) {
        throw new BadRequestException(this.errors.paymentAmountRequired);
      }
      if (initialParsed.lte(0) || initialParsed.gt(servicePrice)) {
        throw new BadRequestException(this.errors.paymentAmountExceedsPrice);
      }
      if (rawPlan === 'INSTALLMENT_EQUAL') {
        const c = dto.installmentCount;
        if (c == null || !Number.isInteger(c) || c < 2 || c > 120) {
          throw new BadRequestException(this.errors.installmentCountInvalid);
        }
      }
      const channel =
        dto.paymentChannel === 'NON_CASH' ? PaymentChannel.NON_CASH : PaymentChannel.CASH;
      const plan = initialParsed.equals(servicePrice) ? 'FULL' : (rawPlan ?? 'INSTALLMENT_FLEXIBLE');
      return {
        paymentAmount: initialParsed,
        paymentPlan: plan,
        installmentCount: rawPlan === 'INSTALLMENT_EQUAL' ? dto.installmentCount : undefined,
        channel,
      };
    }

    const parsed = this.toPrice(dto.paymentAmount ?? dto.initialPaymentAmount);
    if (!parsed || parsed.lte(0)) {
      throw new BadRequestException(this.errors.paymentAmountRequired);
    }
    if (parsed.gt(servicePrice)) {
      throw new BadRequestException(this.errors.paymentAmountExceedsPrice);
    }
    const channel = dto.paymentChannel === 'NON_CASH' ? PaymentChannel.NON_CASH : PaymentChannel.CASH;
    const paymentPlan = parsed.equals(servicePrice) ? 'FULL' : 'INSTALLMENT_FLEXIBLE';
    return {
      paymentAmount: parsed,
      paymentPlan,
      installmentCount: undefined,
      channel,
    };
  }

  private getTodayStart(): Date {
    return utcTodayStartDate();
  }

  private diffDaysInclusive(startDate: Date, endDate: Date): number {
    return diffDaysInclusiveUtc(startDate, endDate);
  }

  /** Конец периода услуги по сроку абонемента (как на фронте при оформлении договора). */
  private calculateServiceEndDate(
    serviceStartDate: Date,
    durationValue: number | null | undefined,
    durationUnit: string | null | undefined,
  ): Date | null {
    return addCalendarDurationUtc(serviceStartDate, durationValue, durationUnit);
  }

  private async resolveServiceEndDateFromCatalog(
    serviceStartDate: Date,
    payload: Record<string, unknown> | null,
  ): Promise<Date | null> {
    const serviceName = typeof payload?.serviceName === 'string' ? payload.serviceName.trim() : '';
    if (!serviceName) return null;
    const catalog = await this.prisma.membershipCatalog.findFirst({
      // Не фильтруем по isActive: у клиента уже может быть договор на эту услугу — срок должен считаться до конца,
      // даже если шаблон убрали из выбора для новых клиентов.
      where: { name: serviceName },
      select: { durationValue: true, durationUnit: true },
    });
    if (!catalog?.durationValue || !catalog.durationUnit) return null;
    return this.calculateServiceEndDate(
      serviceStartDate,
      catalog.durationValue,
      catalog.durationUnit,
    );
  }

  private deriveContractStatus(
    currentStatus: string,
    serviceStartDate?: Date | null,
    serviceEndDate?: Date | null,
  ): ContractDerivedStatus {
    return deriveContractDerivedStatus(currentStatus, serviceStartDate, serviceEndDate);
  }

  /** Пересчитать derivedStatus по датам (после cron истечения / смены календарного дня). */
  private async syncDerivedStatuses() {
    const rows = await this.prisma.contractDocument.findMany({
      select: {
        id: true,
        status: true,
        serviceStartDate: true,
        serviceEndDate: true,
        derivedStatus: true,
      },
    });
    const updates = rows.flatMap((row) => {
      const next = deriveContractDerivedStatus(row.status, row.serviceStartDate, row.serviceEndDate);
      return next === row.derivedStatus ? [] : [{ id: row.id, derivedStatus: next }];
    });
    if (updates.length === 0) return;
    await this.prisma.$transaction(
      updates.map(({ id, derivedStatus }) =>
        this.prisma.contractDocument.update({
          where: { id },
          data: { derivedStatus },
        }),
      ),
    );
  }

  private wouldContractBeActive(
    serviceStartDate?: Date | null,
    serviceEndDate?: Date | null,
  ): boolean {
    return this.deriveContractStatus('ACTIVE', serviceStartDate ?? null, serviceEndDate ?? null) === 'ACTIVE';
  }

  private async clientHasBlockingMembership(clientId: string): Promise<boolean> {
    const count = await this.prisma.contractDocument.count({
      where: {
        clientId,
        derivedStatus: { in: [ContractDerivedStatus.ACTIVE, ContractDerivedStatus.PAUSED] },
      },
    });
    return count > 0;
  }

  private async syncExpiredContracts() {
    const startOfToday = new Date(utcTodayCalendarDayMs());
    await this.prisma.contractDocument.updateMany({
      where: {
        status: { in: ['ACTIVE', 'SAVED'] },
        serviceEndDate: { lt: startOfToday },
      },
      data: { status: 'EXPIRED', derivedStatus: ContractDerivedStatus.EXPIRED },
    });
  }

  private async syncExpiredFreezes() {
    const todayStart = new Date(utcTodayCalendarDayMs());
    const ended = await this.prisma.contractFreeze.findMany({
      where: { endDate: { lt: todayStart } },
      select: { contractId: true },
      distinct: ['contractId'],
    });
    if (ended.length === 0) return;

    const contractIds = ended.map((row) => row.contractId);
    const pausedContracts = await this.prisma.contractDocument.findMany({
      where: { id: { in: contractIds }, status: 'PAUSED' },
      select: { id: true, clientId: true, serviceStartDate: true, serviceEndDate: true },
    });
    if (pausedContracts.length === 0) return;

    const clientIdsToRefresh = new Set<string>();
    await this.prisma.$transaction(
      pausedContracts.map((contract) => {
        const nextDerived = deriveContractDerivedStatus(
          'ACTIVE',
          contract.serviceStartDate,
          contract.serviceEndDate,
        );
        clientIdsToRefresh.add(contract.clientId);
        return this.prisma.contractDocument.update({
          where: { id: contract.id },
          data: { status: nextDerived, derivedStatus: nextDerived },
        });
      }),
    );
    await Promise.all([...clientIdsToRefresh].map((clientId) => this.refreshClientStatus(clientId)));
  }

  private async refreshAllClientStatuses() {
    const clients = await this.prisma.client.findMany({
      select: { id: true },
    });
    if (clients.length === 0) return;
    for (const client of clients) {
      await this.refreshClientStatus(client.id);
    }
  }

  @Cron('0 3 * * *', { timeZone: 'Europe/Moscow' })
  async runNightlyStatusSync() {
    this.logger.log('Starting nightly contracts/client statuses sync');
    await this.syncExpiredFreezes();
    await this.syncExpiredContracts();
    await this.syncDerivedStatuses();
    await this.refreshAllClientStatuses();
    this.logger.log('Nightly contracts/client statuses sync completed');
  }

  async syncStatusesNow() {
    this.logger.log('Starting manual contracts/client statuses sync');
    await this.syncExpiredFreezes();
    await this.syncExpiredContracts();
    await this.syncDerivedStatuses();
    await this.refreshAllClientStatuses();
    this.logger.log('Manual contracts/client statuses sync completed');
    return { ok: true };
  }

  /**
   * Отчёты: число клиентов с хотя бы одним договором в производном статусе ACTIVE.
   */
  async countClientsWithDerivedActiveContract(): Promise<number> {
    const groups = await this.prisma.contractDocument.groupBy({
      by: ['clientId'],
      where: { derivedStatus: ContractDerivedStatus.ACTIVE },
    });
    return groups.length;
  }

  /**
   * Дашборд: распределение договоров по производному статусу (как в отчётах).
   * PENDING — черновики, пауза и прочее, кроме действующих / истёкших / отменённых.
   */
  async getContractsDerivedDistribution(): Promise<
    { status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PENDING'; value: number }[]
  > {
    const groups = await this.prisma.contractDocument.groupBy({
      by: ['derivedStatus'],
      _count: { _all: true },
    });
    let active = 0;
    let expired = 0;
    let cancelled = 0;
    let pending = 0;
    for (const row of groups) {
      const n = row._count._all;
      if (row.derivedStatus === ContractDerivedStatus.ACTIVE) active += n;
      else if (row.derivedStatus === ContractDerivedStatus.EXPIRED) expired += n;
      else if (row.derivedStatus === ContractDerivedStatus.CANCELLED) cancelled += n;
      else pending += n;
    }
    return [
      { status: 'ACTIVE', value: active },
      { status: 'EXPIRED', value: expired },
      { status: 'CANCELLED', value: cancelled },
      { status: 'PENDING', value: pending },
    ];
  }

  private async canCreateContractForClient(
    clientId: string,
    contractNumber?: string,
    opts?: { serviceStartDate?: Date | null; serviceEndDate?: Date | null },
  ) {
    await this.ensureCalendarDayContractState();
    const normalizedNumber = (contractNumber ?? '').trim();
    if (!normalizedNumber) {
      return { ok: false as const, reason: 'CONTRACT_NUMBER_REQUIRED' as const };
    }
    const duplicateByNumber = await this.prisma.contractDocument.findFirst({
      where: { contractNumber: normalizedNumber },
      select: { id: true },
    });
    if (duplicateByNumber) {
      return { ok: false as const, reason: 'CONTRACT_NUMBER_EXISTS' as const };
    }
    const wouldBeActive = this.wouldContractBeActive(opts?.serviceStartDate ?? null, opts?.serviceEndDate ?? null);
    if (wouldBeActive && (await this.clientHasBlockingMembership(clientId))) {
      return { ok: false as const, reason: 'ACTIVE_CONTRACT_EXISTS' as const };
    }
    return { ok: true as const };
  }

  /**
   * Проверка перед открытием формы договора: только номер (уникальность).
   * Ограничение «один ACTIVE» — при сохранении с датами, не здесь.
   */
  async canGenerateForClient(clientId: string, contractNumber?: string) {
    await this.ensureCalendarDayContractState();
    const normalizedNumber = (contractNumber ?? '').trim();
    if (!normalizedNumber) {
      return { ok: false as const, reason: 'CONTRACT_NUMBER_REQUIRED' as const };
    }
    const duplicateByNumber = await this.prisma.contractDocument.findFirst({
      where: { contractNumber: normalizedNumber },
      select: { id: true },
    });
    if (duplicateByNumber) {
      return { ok: false as const, reason: 'CONTRACT_NUMBER_EXISTS' as const };
    }
    return { ok: true as const };
  }

  private async refreshClientStatus(clientId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const client = await db.client.findUnique({
      where: { id: clientId },
      select: { status: true },
    });
    if (!client) return;
    if (client.status === 'BLOCKED') {
      await db.client.update({
        where: { id: clientId },
        data: {
          contractNumber: null,
          contractStartDate: null,
          contractEndDate: null,
        },
      });
      return;
    }
    const contracts = await db.contractDocument.findMany({
      where: { clientId },
      select: {
        id: true,
        contractNumber: true,
        derivedStatus: true,
        serviceStartDate: true,
        serviceEndDate: true,
        createdAt: true,
      },
    });
    const hasActive = contracts.some((c) => c.derivedStatus === ContractDerivedStatus.ACTIVE);
    const hasPaused = contracts.some((c) => c.derivedStatus === ContractDerivedStatus.PAUSED);
    const status: ClientStatus = hasActive ? 'ACTIVE' : hasPaused ? 'PAUSED' : 'INACTIVE';

    const pool = contracts.filter((c) => c.derivedStatus === ContractDerivedStatus.ACTIVE);
    const phasePool =
      pool.length > 0 ? pool : contracts.filter((c) => c.derivedStatus === ContractDerivedStatus.PAUSED);
    let contractNumber: string | null = null;
    let contractStartDate: Date | null = null;
    let contractEndDate: Date | null = null;
    if (phasePool.length > 0) {
      let best = phasePool[0]!;
      let bestCreated = best.createdAt.getTime();
      let bestId = best.id;
      for (const c of phasePool) {
        const ct = c.createdAt.getTime();
        if (ct > bestCreated || (ct === bestCreated && c.id > bestId)) {
          best = c;
          bestCreated = ct;
          bestId = c.id;
        }
      }
      contractNumber = best.contractNumber?.trim() || null;
      contractStartDate = best.serviceStartDate ?? null;
      contractEndDate = best.serviceEndDate ?? null;
    }

    await db.client.update({
      where: { id: clientId },
      data: {
        status,
        contractNumber,
        contractStartDate,
        contractEndDate,
      },
    });
  }

  /**
   * Идемпотентно: `Client.status` и поля «текущего» договора (номер, даты) по `ContractDocument`.
   * У заблокированных — только обнуляет поля договора на клиенте.
   */
  async syncClientSnapshotFromContracts(clientId: string, tx?: Prisma.TransactionClient) {
    await this.refreshClientStatus(clientId, tx);
  }

  private getTemplatePath(): string {
    const configured = this.config.get<string>('CONTRACT_TEMPLATE_PATH');
    if (configured && configured.trim().length > 0) return configured;
    return join(process.cwd(), 'templates', 'contract-template.pdf');
  }

  private getHtmlTemplatePath(): string {
    const configured = this.config.get<string>('CONTRACT_TEMPLATE_HTML_PATH');
    if (configured && configured.trim().length > 0) return configured;
    return join(process.cwd(), 'templates', 'contract-template.html');
  }

  private async loadTemplate(): Promise<Uint8Array> {
    const templatePath = this.getTemplatePath();
    try {
      return await readFile(templatePath);
    } catch {
      throw new NotFoundException(
        `PDF template not found at ${templatePath}. Upload your contract template there or set CONTRACT_TEMPLATE_PATH.`,
      );
    }
  }

  private async loadHtmlTemplate(): Promise<string> {
    const templatePath = this.getHtmlTemplatePath();
    try {
      return await readFile(templatePath, 'utf8');
    } catch {
      throw new NotFoundException(
        `HTML template not found at ${templatePath}. Put your contract html there or set CONTRACT_TEMPLATE_HTML_PATH.`,
      );
    }
  }

  private resolveBrowserExecutablePath(): string | undefined {
    const configured = this.config.get<string>('CHROME_PATH');
    if (configured && configured.trim().length > 0 && existsSync(configured)) {
      return configured;
    }

    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ];
    return candidates.find((path) => existsSync(path));
  }

  private buildPayload(dto: GenerateContractDto): Record<string, string> {
    const fullName = [dto.lastName, dto.firstName, dto.middleName]
      .filter((v): v is string => Boolean(v && v.trim()))
      .join(' ');
    const today = formatRuDate(dto.contractDate) || formatRuDate(new Date().toISOString());
    return {
      firstName: dto.firstName,
      lastName: dto.lastName,
      middleName: dto.middleName ?? '',
      fullName,
      address: dto.address ?? '',
      passportNumber: dto.passportNumber ?? '',
      passportIssuedBy: dto.passportIssuedBy ?? '',
      passportIssuedAt: formatRuDate(dto.passportIssuedAt),
      phone: dto.phone ?? '',
      email: dto.email ?? '',
      serviceName: dto.serviceName ?? '',
      servicePrice: dto.servicePrice ?? '',
      contractDate: today,
      serviceStartDate: formatRuDate(dto.serviceStartDate),
      serviceEndDate: formatRuDate(dto.serviceEndDate),
      birthDate: formatRuDate(dto.birthDate),
      contractNumber: dto.contractNumber ?? '',
      city: dto.city ?? '',
      clubAddress: dto.clubAddress ?? '',
      executorName: dto.executorName ?? '',
      executorRepresentative: dto.executorRepresentative ?? '',
      contractDateVerbose: today,
      serviceStartDateVerbose: formatRuDate(dto.serviceStartDate),
      serviceEndDateVerbose: formatRuDate(dto.serviceEndDate),
      birthDateVerbose: formatRuDate(dto.birthDate),
      ...(dto.extraFields ?? {}),
    };
  }

  private getAliases(key: string): string[] {
    const aliases: Record<string, string[]> = {
      firstName: ['firstname', 'имя'],
      lastName: ['lastname', 'фамилия'],
      middleName: ['middlename', 'отчество'],
      fullName: ['fullname', 'фио', 'заказчик'],
      address: ['address', 'адрес'],
      passportNumber: ['passportnumber', 'паспорт', 'паспортномер'],
      passportIssuedBy: ['passportissuedby', 'паспорткемвыдан'],
      passportIssuedAt: ['passportissuedat', 'паспортдатавыдачи'],
      phone: ['phone', 'телефон'],
      email: ['email', 'e-mail'],
      serviceName: ['servicename', 'услуга'],
      servicePrice: ['serviceprice', 'стоимость', 'цена'],
      contractDate: ['contractdate', 'датадоговора', 'дата'],
      serviceStartDate: ['servicestartdate', 'датаначала'],
      serviceEndDate: ['serviceenddate', 'датаокончания'],
      executorName: ['executorname', 'исполнитель'],
    };
    return aliases[key] ?? [key];
  }

  async renderHtml(dto: GenerateContractDto): Promise<string> {
    const template = await this.loadHtmlTemplate();
    const payload = this.buildPayload(dto);
    const normalizedPayload = new Map<string, string>();
    for (const [key, value] of Object.entries(payload)) {
      normalizedPayload.set(normalizeFieldName(key), value);
    }

    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, rawKey: string) => {
      const key = normalizeFieldName(String(rawKey));
      const value = normalizedPayload.get(key) ?? '';
      return escapeHtml(value);
    });
  }

  private setFieldValue(field: unknown, value: string) {
    if (!value) return;
    if (field instanceof PDFTextField) {
      field.setText(value);
      return;
    }
    if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      const hasGetOptions =
        typeof field === 'object' &&
        field !== null &&
        'getOptions' in field &&
        typeof (field as { getOptions: () => string[] }).getOptions === 'function';
      const options = hasGetOptions ? (field as { getOptions: () => string[] }).getOptions() : [];
      if (options.length > 0 && !options.includes(value)) {
        return;
      }
      try {
        field.select(value);
      } catch {
        // Ignore invalid option selections to keep PDF generation resilient.
      }
    }
  }

  async getTemplateFields() {
    const bytes = await this.loadTemplate();
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();
    return form.getFields().map((field) => ({
      name: field.getName(),
      type: field.constructor.name,
    }));
  }

  async generate(dto: GenerateContractDto): Promise<Uint8Array> {
    const html = await this.renderHtml(dto);
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
    try {
      const executablePath = this.resolveBrowserExecutablePath();
      if (!executablePath) {
        throw new ServiceUnavailableException(
          'Contract PDF is unavailable: Chromium is not installed in this API image. Rebuild with INSTALL_CHROMIUM=1 or run PDF on a machine with more disk.',
        );
      }
      browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' },
      });
      this.logger.log(`Generated contract PDF from HTML, bytes=${pdf.length}`);
      return pdf;
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      const reason =
        error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      this.logger.error(`Failed to render contract PDF: ${reason}`);
      throw new InternalServerErrorException(`Failed to render contract PDF: ${reason}`);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  async listClientContracts(clientId: string) {
    await this.ensureCalendarDayContractState();
    const rows = await this.prisma.contractDocument.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        contractNumber: true,
        derivedStatus: true,
        contractDate: true,
        serviceStartDate: true,
        serviceEndDate: true,
        servicePrice: true,
        s3Url: true,
        createdAt: true,
        payload: true,
        freezes: {
          select: { endDate: true, durationDays: true },
          orderBy: { endDate: 'desc' },
          take: 1,
        },
      },
    });
    const paidMap = await this.aggregateNetPaidByContractIds(rows.map((r) => r.id));
    return rows.map((row) => {
      const net = paidMap.get(row.id) ?? new Prisma.Decimal(0);
      const priceDec = row.servicePrice == null ? null : new Prisma.Decimal(row.servicePrice);
      const balanceNum = priceDec ? priceDec.minus(net) : new Prisma.Decimal(0);
      const fullyPaid = priceDec == null ? true : balanceNum.lte(new Prisma.Decimal('0.005'));
      const paidTotal = net.toFixed(2);
      const balanceDue = priceDec ? (fullyPaid ? '0.00' : balanceNum.toFixed(2)) : null;
      const payloadObj = row.payload as Record<string, unknown> | null;
      const rawPlan = payloadObj?.paymentPlan;
      const paymentPlan =
        rawPlan === 'INSTALLMENT_FLEXIBLE' || rawPlan === 'INSTALLMENT_EQUAL' || rawPlan === 'FULL'
          ? rawPlan
          : 'FULL';
      const icRaw = payloadObj?.installmentCount;
      const installmentCount =
        typeof icRaw === 'number' && Number.isInteger(icRaw)
          ? icRaw
          : typeof icRaw === 'string' && /^\s*\d+\s*$/.test(icRaw)
            ? Number.parseInt(icRaw.trim(), 10)
            : null;
      let suggestedEqualPayment: string | null = null;
      if (
        paymentPlan === 'INSTALLMENT_EQUAL' &&
        installmentCount != null &&
        installmentCount >= 2 &&
        row.servicePrice != null
      ) {
        suggestedEqualPayment = new Prisma.Decimal(row.servicePrice)
          .dividedBy(installmentCount)
          .toFixed(2);
      }
      const serviceName =
        typeof payloadObj?.serviceName === 'string' ? payloadObj.serviceName.trim() : null;
      const { payload: _p, ...rest } = row;
      return {
        ...rest,
        status: row.derivedStatus,
        pauseUntil: row.freezes[0]?.endDate ?? null,
        pauseDurationDays: row.freezes[0]?.durationDays ?? null,
        paidTotal,
        balanceDue,
        fullyPaid,
        paymentPlan,
        installmentCount,
        suggestedEqualPayment,
        serviceName: serviceName || null,
      };
    });
  }

  /**
   * Для сканера прохода: среди ACTIVE (если есть — только они, иначе PAUSED) берём договоры с остатком к оплате
   * и показываем самый новый по createdAt. Раньше сначала выбирался «любой» новейший ACTIVE и только потом
   * проверялся долг — если новейший уже закрыт по оплате, остаток по другому активному договору терялся.
   */
  async getPrimaryContractUnpaidSummaryForVisitLookup(clientId: string): Promise<{
    contractNumber: string;
    balanceDue: string;
  } | null> {
    const list = await this.listClientContracts(clientId);
    const actives = list.filter((c) => c.status === 'ACTIVE');
    const paused = list.filter((c) => c.status === 'PAUSED');
    const phasePool = actives.length > 0 ? actives : paused;
    if (phasePool.length === 0) return null;

    const hasUnpaidBalance = (c: (typeof list)[number]) => {
      if (c.fullyPaid === true) return false;
      const bal = Number(String(c.balanceDue ?? '0').replace(',', '.'));
      return Number.isFinite(bal) && bal > 0.005;
    };

    const withDebt = phasePool.filter(hasUnpaidBalance);
    if (withDebt.length === 0) {
      if (actives.length > 0) {
        const pausedWithDebt = paused.filter(hasUnpaidBalance);
        if (pausedWithDebt.length === 0) return null;
        return this.pickNewestContractUnpaidSummary(pausedWithDebt);
      }
      return null;
    }

    return this.pickNewestContractUnpaidSummary(withDebt);
  }

  private pickNewestContractUnpaidSummary(
    pool: Array<{ id: string; contractNumber: string; createdAt: Date | string; balanceDue?: string | null }>,
  ): { contractNumber: string; balanceDue: string } {
    let best = pool[0]!;
    let bestCreated = new Date(best.createdAt).getTime();
    let bestId = best.id;
    for (const c of pool) {
      const ct = new Date(c.createdAt).getTime();
      if (ct > bestCreated || (ct === bestCreated && c.id > bestId)) {
        best = c;
        bestCreated = ct;
        bestId = c.id;
      }
    }
    const bal = Number(String(best.balanceDue ?? '0').replace(',', '.'));
    const num = (best.contractNumber ?? '').trim();
    return {
      contractNumber: num.length > 0 ? num : '—',
      balanceDue: bal.toFixed(2),
    };
  }

  async listContracts(filters?: {
    clientId?: string;
    status?: string;
    from?: string;
    to?: string;
  }) {
    await this.ensureCalendarDayContractState();
    const fromDate = filters?.from ? this.toDate(filters.from) : null;
    const toDate = filters?.to ? this.toDate(filters.to) : null;
    if ((filters?.from && !fromDate) || (filters?.to && !toDate)) {
      throw new BadRequestException(this.errors.invalidDateFilter);
    }
    if (fromDate && toDate && fromDate > toDate) {
      throw new BadRequestException(this.errors.invalidDateRange);
    }
    const rows = await this.prisma.contractDocument.findMany({
      where: {
        clientId: filters?.clientId || undefined,
        derivedStatus: filters?.status
          ? (filters.status as ContractDerivedStatus)
          : undefined,
        createdAt:
          filters?.from || filters?.to
            ? {
                gte: fromDate ?? undefined,
                lte: toDate ?? undefined,
              }
            : undefined,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        clientId: true,
        contractNumber: true,
        derivedStatus: true,
        contractDate: true,
        serviceStartDate: true,
        serviceEndDate: true,
        servicePrice: true,
        s3Url: true,
        createdAt: true,
        client: { select: { id: true, firstName: true, lastName: true, middleName: true, phone: true } },
      },
    });
    return rows.map((row) => ({
      ...row,
      status: row.derivedStatus,
    }));
  }

  async pause(contractId: string, dto: FreezeContractDto = {}, actorId: string) {
    await this.syncExpiredFreezes();
    const existing = await this.prisma.contractDocument.findUnique({
      where: { id: contractId },
      select: { id: true, clientId: true, status: true, serviceStartDate: true, serviceEndDate: true },
    });
    if (!existing) throw new NotFoundException('Contract not found');
    const derived = this.deriveContractStatus(existing.status, existing.serviceStartDate, existing.serviceEndDate);
    if (derived !== 'ACTIVE') {
      if (derived === 'CANCELLED' || derived === 'EXPIRED') {
        throw new BadRequestException(this.errors.cannotPauseFinished);
      }
      throw new BadRequestException(this.errors.onlyActiveCanFreeze);
    }

    const today = this.getTodayStart();
    const hasManualRange = Boolean(dto.startDate || dto.endDate);
    let startDate = today;
    let endDate = today;
    if (hasManualRange) {
      if (!dto.startDate || !dto.endDate) {
        throw new BadRequestException(this.errors.freezeDurationInvalid);
      }
      const start = this.toDate(dto.startDate);
      const end = this.toDate(dto.endDate);
      if (!start || !end || end < start) throw new BadRequestException(this.errors.freezeDurationInvalid);
      startDate = start;
      endDate = end;
    } else {
      const durationDays = dto.durationDays ?? 7;
      startDate = today;
      endDate = new Date(today);
      endDate.setDate(endDate.getDate() + durationDays - 1);
    }
    startDate = new Date(startDate);
    endDate = new Date(endDate);
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);
    const durationDays = this.diffDaysInclusive(startDate, endDate);
    if (durationDays < ContractsService.FREEZE_MIN_DAYS) {
      throw new BadRequestException(this.errors.freezeDurationInvalid);
    }
    const contractStart = existing.serviceStartDate ? new Date(existing.serviceStartDate) : null;
    const contractEnd = existing.serviceEndDate ? new Date(existing.serviceEndDate) : null;
    if (contractStart) contractStart.setHours(0, 0, 0, 0);
    if (contractEnd) contractEnd.setHours(0, 0, 0, 0);
    if ((contractStart && startDate < contractStart) || (contractEnd && endDate > contractEnd)) {
      throw new BadRequestException(this.errors.freezeOutOfRange);
    }
    const overlaps = await this.prisma.contractFreeze.findFirst({
      where: {
        contractId,
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { id: true },
    });
    if (overlaps) {
      throw new BadRequestException(this.errors.freezeOverlaps);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.contractFreeze.create({
        data: {
          contractId,
          startDate,
          endDate,
          durationDays,
          reason: dto.reason?.trim() || null,
          createdById: actorId,
        },
      });
      return tx.contractDocument.update({
        where: { id: contractId },
        data: { status: 'PAUSED', derivedStatus: ContractDerivedStatus.PAUSED },
        select: { id: true, status: true },
      });
    });
    await this.refreshClientStatus(existing.clientId);
    this.logger.warn(
      `AUDIT contract.pause reqId=${this.requestContext.getRequestId()} actorId=${actorId} contractId=${contractId} clientId=${existing.clientId}`,
    );
    return updated;
  }

  async resume(contractId: string) {
    await this.syncExpiredFreezes();
    const existing = await this.prisma.contractDocument.findUnique({
      where: { id: contractId },
      select: { id: true, clientId: true, status: true, serviceStartDate: true, serviceEndDate: true },
    });
    if (!existing) throw new NotFoundException('Contract not found');
    if (existing.status !== 'PAUSED') {
      throw new BadRequestException(this.errors.onlyPausedCanResume);
    }
    const nextDerived = this.deriveContractStatus('ACTIVE', existing.serviceStartDate, existing.serviceEndDate);
    const updated = await this.prisma.contractDocument.update({
      where: { id: contractId },
      data: {
        status: nextDerived,
        derivedStatus: nextDerived,
      },
      select: { id: true, status: true },
    });
    await this.refreshClientStatus(existing.clientId);
    this.logger.warn(
      `AUDIT contract.resume reqId=${this.requestContext.getRequestId()} contractId=${contractId} clientId=${existing.clientId}`,
    );
    return updated;
  }

  /**
   * Запуск ожидающего договора: менеджер задаёт дату начала услуги (и при необходимости конец).
   * Допускается только один ACTIVE/PAUSED на клиента.
   */
  async activate(contractId: string, dto: ActivateContractDto, actorId: string) {
    await this.ensureCalendarDayContractState();

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.contractDocument.findUnique({
        where: { id: contractId },
        select: {
          id: true,
          clientId: true,
          status: true,
          derivedStatus: true,
          serviceStartDate: true,
          serviceEndDate: true,
          payload: true,
        },
      });
      if (!existing) throw new NotFoundException('Contract not found');
      if (existing.derivedStatus !== ContractDerivedStatus.SAVED) {
        throw new BadRequestException(this.errors.onlySavedCanActivate);
      }
      const serviceStartDate = this.toDate(dto.serviceStartDate);
      if (!serviceStartDate) {
        throw new BadRequestException(this.errors.serviceStartRequired);
      }
      const payload = existing.payload as Record<string, unknown> | null;
      let serviceEndDate = this.toDate(dto.serviceEndDate) ?? existing.serviceEndDate;
      if (!serviceEndDate) {
        const fromPayload = payload?.serviceEndDate;
        if (typeof fromPayload === 'string') {
          serviceEndDate = this.toDate(fromPayload);
        }
      }
      if (!serviceEndDate) {
        serviceEndDate = await this.resolveServiceEndDateFromCatalog(serviceStartDate, payload);
      }
      if (!serviceEndDate) {
        throw new BadRequestException(this.errors.serviceEndRequired);
      }
      if (serviceEndDate && serviceEndDate < serviceStartDate) {
        throw new BadRequestException(this.errors.serviceDateRangeInvalid);
      }
      const blockingCount = await tx.contractDocument.count({
        where: {
          clientId: existing.clientId,
          NOT: { id: contractId },
          derivedStatus: { in: [ContractDerivedStatus.ACTIVE, ContractDerivedStatus.PAUSED] },
        },
      });
      if (blockingCount > 0) {
        throw new BadRequestException(this.errors.activeMembershipBlocksActivate);
      }
      const nextDerived = this.deriveContractStatus('ACTIVE', serviceStartDate, serviceEndDate);
      const payloadObj = (existing.payload as Record<string, unknown> | null) ?? {};
      const nextPayload: Record<string, unknown> = {
        ...payloadObj,
        serviceStartDate: dto.serviceStartDate,
        ...(serviceEndDate ? { serviceEndDate: isoYmdFromUtcDate(serviceEndDate) } : {}),
      };
      return tx.contractDocument.update({
        where: { id: contractId },
        data: {
          serviceStartDate,
          serviceEndDate,
          status: nextDerived,
          derivedStatus: nextDerived,
          payload: nextPayload as object,
        },
        select: { id: true, status: true, serviceStartDate: true, serviceEndDate: true, clientId: true },
      });
    });

    await this.refreshClientStatus(updated.clientId);
    this.logger.warn(
      `AUDIT contract.activate reqId=${this.requestContext.getRequestId()} actorId=${actorId} contractId=${contractId} clientId=${updated.clientId}`,
    );
    return {
      id: updated.id,
      status: updated.status,
      serviceStartDate: updated.serviceStartDate,
      serviceEndDate: updated.serviceEndDate,
    };
  }

  async terminate(contractId: string) {
    const existing = await this.prisma.contractDocument.findUnique({
      where: { id: contractId },
      select: { id: true, clientId: true },
    });
    if (!existing) throw new NotFoundException('Contract not found');
    const updated = await this.prisma.contractDocument.update({
      where: { id: contractId },
      data: { status: 'CANCELLED', derivedStatus: ContractDerivedStatus.CANCELLED },
      select: { id: true, status: true },
    });
    await this.refreshClientStatus(existing.clientId);
    this.logger.warn(
      `AUDIT contract.terminate reqId=${this.requestContext.getRequestId()} contractId=${contractId} clientId=${existing.clientId}`,
    );
    return updated;
  }

  async cancelWithRefund(contractId: string, dto: CancelContractDto, actorId: string) {
    const existing = await this.prisma.contractDocument.findUnique({
      where: { id: contractId },
      select: { id: true, clientId: true, status: true },
    });
    if (!existing) throw new NotFoundException('Contract not found');
    const refundAmount = new Prisma.Decimal(dto.refundAmount.toFixed(2));
    if (refundAmount.gt(0) && !dto.refundMethod) {
      throw new BadRequestException(this.errors.refundMethodRequired);
    }

    await this.prisma.$transaction(async (tx) => {
      const [paidAgg, refundedAgg] = await Promise.all([
        tx.payment.aggregate({
          where: {
            contractDocumentId: contractId,
            operationType: PaymentOperationType.SALE,
            status: PaymentStatus.PAID,
          },
          _sum: { amount: true },
        }),
        tx.payment.aggregate({
          where: {
            contractDocumentId: contractId,
            operationType: PaymentOperationType.REFUND,
            status: PaymentStatus.REFUNDED,
          },
          _sum: { amount: true },
        }),
      ]);
      const totalPaid = paidAgg._sum.amount ?? new Prisma.Decimal(0);
      const totalRefunded = refundedAgg._sum.amount ?? new Prisma.Decimal(0);
      if (totalRefunded.plus(refundAmount).gt(totalPaid)) {
        throw new BadRequestException(this.errors.refundExceedsPaid);
      }

      if (refundAmount.gt(0)) {
        await tx.payment.create({
          data: {
            clientId: existing.clientId,
            contractDocumentId: contractId,
            amount: refundAmount,
            paidAt: new Date(),
            status: PaymentStatus.REFUNDED,
            operationType: PaymentOperationType.REFUND,
            refundMethod: dto.refundMethod as RefundMethod,
            comment: dto.comment?.trim() || 'Contract cancellation refund',
            processedById: actorId,
          },
        });
      }
      await tx.contractDocument.update({
        where: { id: contractId },
        data: { status: 'CANCELLED', derivedStatus: ContractDerivedStatus.CANCELLED },
      });
      await this.refreshClientStatus(existing.clientId, tx);
    });
    this.logger.warn(
      `AUDIT contract.cancel_with_refund reqId=${this.requestContext.getRequestId()} actorId=${actorId} contractId=${contractId} clientId=${existing.clientId} refund=${Number(refundAmount)}`,
    );
    return { id: contractId, status: 'CANCELLED', refunded: Number(refundAmount) };
  }

  async remove(contractId: string) {
    const existing = await this.prisma.contractDocument.findUnique({
      where: { id: contractId },
      select: { id: true, s3Key: true, clientId: true },
    });
    if (!existing) throw new NotFoundException('Contract not found');

    if (existing.s3Key) {
      try {
        await this.storage.deleteObject(existing.s3Key);
      } catch (error: unknown) {
        const reason = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
        this.logger.warn(`Failed to delete contract PDF from storage: ${reason}`);
      }
    }

    await this.prisma.contractDocument.delete({ where: { id: contractId } });
    await this.refreshClientStatus(existing.clientId);
    this.logger.warn(
      `AUDIT contract.delete reqId=${this.requestContext.getRequestId()} contractId=${contractId} clientId=${existing.clientId}`,
    );
    return { id: contractId, deleted: true };
  }

  async getOpenUrl(contractId: string) {
    const document = await this.prisma.contractDocument.findUnique({
      where: { id: contractId },
      select: { id: true, s3Key: true, s3Url: true },
    });
    if (!document) throw new NotFoundException('Contract not found');
    if (!document.s3Key) return { url: document.s3Url ?? null };
    const url = await this.storage.getReadUrl(document.s3Key, 600);
    return { url };
  }

  async generateForClient(clientId: string): Promise<Uint8Array> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        middleName: true,
        birthDate: true,
        phone: true,
        email: true,
        address: true,
        passport: true,
        passportIssuedBy: true,
        passportIssuedAt: true,
        contractNumber: true,
        contractStartDate: true,
        contractEndDate: true,
        paymentDate: true,
        membershipType: true,
      },
    });
    if (!client) throw new NotFoundException('Client not found');

    const dto: GenerateContractDto = {
      firstName: client.firstName,
      lastName: client.lastName,
      middleName: client.middleName ?? undefined,
      birthDate: client.birthDate?.toISOString(),
      phone: client.phone ?? undefined,
      email: client.email ?? undefined,
      address: client.address ?? undefined,
      passportNumber: client.passport ?? undefined,
      passportIssuedBy: client.passportIssuedBy ?? undefined,
      passportIssuedAt: client.passportIssuedAt?.toISOString(),
      contractNumber: client.contractNumber ?? undefined,
      contractDate: client.paymentDate?.toISOString() ?? new Date().toISOString(),
      serviceStartDate: client.contractStartDate?.toISOString(),
      serviceEndDate: client.contractEndDate?.toISOString(),
      serviceName: client.membershipType ?? undefined,
      flatten: true,
      extraFields: {},
    };

    const pdfBytes = await this.generate(dto);
    // Preview only: contract persistence must go through saveClientContractFromForm,
    // where we enforce uniqueness, active contract checks, payment linkage and status sync.
    return pdfBytes;
  }

  async regenerateClientContract(clientId: string, contractId: string): Promise<Uint8Array> {
    const document = await this.prisma.contractDocument.findFirst({
      where: { id: contractId, clientId },
      select: { payload: true },
    });
    if (!document) throw new NotFoundException('Contract document not found');
    return this.generate(document.payload as unknown as GenerateContractDto);
  }

  async saveClientContractFromForm(clientId: string, dto: GenerateContractDto, actorId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true },
    });
    if (!client) throw new NotFoundException('Client not found');

    const serviceStartDate = this.toDate(dto.serviceStartDate);
    const serviceEndDate = this.toDate(dto.serviceEndDate);
    const guard = await this.canCreateContractForClient(clientId, dto.contractNumber, {
      serviceStartDate,
      serviceEndDate,
    });
    if (!guard.ok) {
      if (guard.reason === 'ACTIVE_CONTRACT_EXISTS') {
        throw new BadRequestException(this.errors.activeContractExists);
      }
      if (guard.reason === 'CONTRACT_NUMBER_EXISTS') {
        throw new BadRequestException(this.errors.contractNumberExists);
      }
      throw new BadRequestException(this.errors.contractNumberRequired);
    }

    const servicePrice = this.toPrice(dto.servicePrice);
    if (!servicePrice) {
      throw new BadRequestException(this.errors.servicePriceRequired);
    }

    const { paymentAmount, paymentPlan, installmentCount, channel } = this.resolveContractSigningPayment(
      dto,
      servicePrice,
    );
    const persistDto: GenerateContractDto = {
      ...dto,
      paymentPlan,
      installmentCount,
      paymentAmount: paymentAmount.toFixed(2),
      paymentChannel: channel === PaymentChannel.NON_CASH ? 'NON_CASH' : 'CASH',
    };

    if (serviceStartDate && serviceEndDate && serviceEndDate < serviceStartDate) {
      throw new BadRequestException(this.errors.serviceDateRangeInvalid);
    }
    const initialDerived = serviceStartDate
      ? this.deriveContractStatus('ACTIVE', serviceStartDate, serviceEndDate)
      : ContractDerivedStatus.SAVED;
    const pdfBytes = await this.generate(dto);
    let created: { id: string; contractNumber: string; createdAt: Date };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const contract = await tx.contractDocument.create({
          data: {
            clientId,
            contractNumber: dto.contractNumber ?? '',
            status: initialDerived,
            derivedStatus: initialDerived,
            contractDate: this.toDate(dto.contractDate),
            serviceStartDate,
            serviceEndDate,
            servicePrice,
            payload: persistDto as unknown as object,
          },
          select: { id: true, contractNumber: true, createdAt: true },
        });

        const paymentComment =
          paymentPlan === 'FULL'
            ? 'Оплата при заключении договора'
            : `Первый платёж (остаток по договору)`;
        await tx.payment.create({
          data: {
            clientId,
            contractDocumentId: contract.id,
            amount: paymentAmount,
            status: PaymentStatus.PAID,
            operationType: PaymentOperationType.SALE,
            channel,
            paidAt: new Date(),
            processedById: actorId,
            comment: paymentComment,
          },
        });

        await this.refreshClientStatus(clientId, tx);
        return contract;
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target) ? error.meta.target : [];
        if (target.includes('contractNumber') || target.includes('ContractDocument_contractNumber_key')) {
          throw new ConflictException(this.errors.contractNumberExists);
        }
      }
      throw error;
    }
    const s3Key = `contracts/${clientId}/${created.id}.pdf`;
    const uploaded = await this.storage.uploadPdf(s3Key, pdfBytes);
    if (uploaded.key || uploaded.url) {
      await this.prisma.contractDocument.update({
        where: { id: created.id },
        data: { s3Key: uploaded.key ?? undefined, s3Url: uploaded.url ?? undefined },
      });
    }
    this.logger.log(
      `AUDIT contract.create reqId=${this.requestContext.getRequestId()} actorId=${actorId} contractId=${created.id} clientId=${clientId} contractNumber=${created.contractNumber}`,
    );
    return { ...created, pdfBytes };
  }
}
