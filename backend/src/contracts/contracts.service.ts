import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { ClientStatus, PaymentOperationType, PaymentStatus, Prisma, RefundMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../common/request-context.service';
import { utcCalendarDayMs, utcTodayCalendarDayMs } from '../common/utc-calendar-day';
import { StorageService } from '../storage/storage.service';
import { PDFDocument, PDFDropdown, PDFOptionList, PDFTextField } from 'pdf-lib';
import puppeteer from 'puppeteer';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);
  private static readonly FREEZE_MIN_DAYS = 7;
  private static readonly FREEZE_MAX_DAYS = 30;
  private readonly errors = {
    invalidDateFilter: { code: 'INVALID_DATE_FILTER', message: 'Invalid date filter' },
    invalidDateRange: { code: 'INVALID_DATE_RANGE', message: 'Invalid date range' },
    unsupportedContractStatus: { code: 'UNSUPPORTED_CONTRACT_STATUS', message: 'Unsupported contract status' },
    cannotPauseFinished: { code: 'CANNOT_PAUSE_FINISHED_CONTRACT', message: 'Cannot pause finished contract' },
    onlyPausedCanResume: { code: 'ONLY_PAUSED_CAN_RESUME', message: 'Only paused contract can be resumed' },
    activeContractExists: { code: 'ACTIVE_CONTRACT_EXISTS', message: 'Active contract already exists for this client' },
    contractNumberExists: { code: 'CONTRACT_NUMBER_EXISTS', message: 'Contract number already exists' },
    contractNumberRequired: { code: 'CONTRACT_NUMBER_REQUIRED', message: 'Contract number is required' },
    servicePriceRequired: { code: 'SERVICE_PRICE_REQUIRED', message: 'Service price is required' },
    serviceDateRangeInvalid: { code: 'SERVICE_DATE_RANGE_INVALID', message: 'Service end date must be after service start date' },
    freezeOutOfRange: { code: 'FREEZE_OUT_OF_CONTRACT_RANGE', message: 'Freeze must be within contract dates' },
    freezeDurationInvalid: { code: 'FREEZE_DURATION_INVALID', message: 'Freeze duration is outside allowed limits' },
    freezeOverlaps: { code: 'FREEZE_OVERLAPS', message: 'Freeze overlaps existing freeze period' },
    onlyActiveCanFreeze: { code: 'ONLY_ACTIVE_CAN_FREEZE', message: 'Only active contract can be frozen' },
    refundExceedsPaid: { code: 'REFUND_LIMIT_EXCEEDED', message: 'Refund exceeds paid amount' },
    refundMethodRequired: { code: 'REFUND_METHOD_REQUIRED', message: 'Refund method is required for positive refund' },
  } as const;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly requestContext: RequestContextService,
  ) {}

  private toDate(value?: string) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }

  private toPrice(value?: string) {
    if (!value) return null;
    const normalized = value.replace(',', '.').trim();
    if (!normalized) return null;
    const num = Number(normalized);
    if (!Number.isFinite(num)) return null;
    return new Prisma.Decimal(num.toFixed(2));
  }

  private getTodayStart(): Date {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }

  private diffDaysInclusive(startDate: Date, endDate: Date): number {
    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  }

  private deriveContractStatus(
    currentStatus: string,
    serviceStartDate?: Date | null,
    serviceEndDate?: Date | null,
  ): string {
    if (currentStatus === 'DRAFT') return 'SAVED';
    if (currentStatus === 'CANCELLED') return 'CANCELLED';
    const today = utcTodayCalendarDayMs();
    if (currentStatus === 'EXPIRED') {
      const endExpired = serviceEndDate ? utcCalendarDayMs(new Date(serviceEndDate)) : null;
      if (endExpired !== null && endExpired >= today) return 'ACTIVE';
      return 'EXPIRED';
    }
    const start = serviceStartDate ? utcCalendarDayMs(new Date(serviceStartDate)) : null;
    const end = serviceEndDate ? utcCalendarDayMs(new Date(serviceEndDate)) : null;
    if (end !== null && end < today) return 'EXPIRED';
    if (currentStatus === 'PAUSED') return 'PAUSED';
    if (currentStatus === 'SIGNED') return 'ACTIVE';
    if (start !== null && start > today) return 'SAVED';
    return 'ACTIVE';
  }

  private async syncExpiredContracts() {
    const startOfToday = new Date(utcTodayCalendarDayMs());
    await this.prisma.contractDocument.updateMany({
      where: {
        status: { in: ['ACTIVE', 'SAVED'] },
        serviceEndDate: { lt: startOfToday },
      },
      data: { status: 'EXPIRED' },
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
    for (const row of ended) {
      const contract = await this.prisma.contractDocument.findUnique({
        where: { id: row.contractId },
        select: { id: true, clientId: true, status: true, serviceStartDate: true, serviceEndDate: true },
      });
      if (!contract || contract.status !== 'PAUSED') continue;
      const nextStatus = this.deriveContractStatus('ACTIVE', contract.serviceStartDate, contract.serviceEndDate);
      await this.prisma.contractDocument.update({
        where: { id: contract.id },
        data: { status: nextStatus },
      });
      await this.refreshClientStatus(contract.clientId);
    }
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
    await this.refreshAllClientStatuses();
    this.logger.log('Nightly contracts/client statuses sync completed');
  }

  async syncStatusesNow() {
    this.logger.log('Starting manual contracts/client statuses sync');
    await this.syncExpiredFreezes();
    await this.syncExpiredContracts();
    await this.refreshAllClientStatuses();
    this.logger.log('Manual contracts/client statuses sync completed');
    return { ok: true };
  }

  private async canCreateContractForClient(clientId: string, contractNumber?: string) {
    await this.syncExpiredFreezes();
    await this.syncExpiredContracts();
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
    const clientContracts = await this.prisma.contractDocument.findMany({
      where: { clientId },
      select: { status: true, serviceStartDate: true, serviceEndDate: true },
    });
    const hasActive = clientContracts.some(
      (contract) =>
        this.deriveContractStatus(contract.status, contract.serviceStartDate, contract.serviceEndDate) === 'ACTIVE',
    );
    if (hasActive) {
      return { ok: false as const, reason: 'ACTIVE_CONTRACT_EXISTS' as const };
    }
    return { ok: true as const };
  }

  async canGenerateForClient(clientId: string, contractNumber?: string) {
    return this.canCreateContractForClient(clientId, contractNumber);
  }

  private async refreshClientStatus(clientId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const client = await db.client.findUnique({
      where: { id: clientId },
      select: { status: true },
    });
    if (!client) return;
    if (client.status === 'BLOCKED') return;
    const contracts = await db.contractDocument.findMany({
      where: { clientId },
      select: { status: true, serviceStartDate: true, serviceEndDate: true },
    });
    const hasActive = contracts.some((contract) => {
      return this.deriveContractStatus(contract.status, contract.serviceStartDate, contract.serviceEndDate) === 'ACTIVE';
    });
    const hasPaused = contracts.some((contract) => {
      return this.deriveContractStatus(contract.status, contract.serviceStartDate, contract.serviceEndDate) === 'PAUSED';
    });
    const status: ClientStatus = hasActive ? 'ACTIVE' : hasPaused ? 'PAUSED' : 'INACTIVE';
    await db.client.update({
      where: { id: clientId },
      data: { status },
    });
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
    await this.syncExpiredFreezes();
    await this.syncExpiredContracts();
    const rows = await this.prisma.contractDocument.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        contractNumber: true,
        status: true,
        contractDate: true,
        serviceStartDate: true,
        serviceEndDate: true,
        servicePrice: true,
        s3Url: true,
        createdAt: true,
        freezes: {
          select: { endDate: true },
          orderBy: { endDate: 'desc' },
          take: 1,
        },
      },
    });
    return rows.map((row) => ({
      ...row,
      status: this.deriveContractStatus(row.status, row.serviceStartDate, row.serviceEndDate),
      pauseUntil: row.freezes[0]?.endDate ?? null,
    }));
  }

  async listContracts(filters?: {
    clientId?: string;
    status?: string;
    from?: string;
    to?: string;
  }) {
    await this.syncExpiredFreezes();
    await this.syncExpiredContracts();
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
        status: true,
        contractDate: true,
        serviceStartDate: true,
        serviceEndDate: true,
        servicePrice: true,
        s3Url: true,
        createdAt: true,
        client: { select: { firstName: true, lastName: true, middleName: true } },
      },
    });
    const normalized = rows.map((row) => ({
      ...row,
      status: this.deriveContractStatus(row.status, row.serviceStartDate, row.serviceEndDate),
    }));
    if (!filters?.status) return normalized;
    return normalized.filter((row) => row.status === filters.status);
  }

  async updateStatus(contractId: string, status: string) {
    const existing = await this.prisma.contractDocument.findUnique({
      where: { id: contractId },
      select: { id: true, clientId: true },
    });
    if (!existing) throw new NotFoundException('Contract not found');
    const allowed = ['SAVED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED'];
    if (!allowed.includes(status)) {
      throw new BadRequestException(this.errors.unsupportedContractStatus);
    }
    const updated = await this.prisma.contractDocument.update({
      where: { id: contractId },
      data: { status },
      select: { id: true, status: true },
    });
    await this.refreshClientStatus(existing.clientId);
    return updated;
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
    if (durationDays < ContractsService.FREEZE_MIN_DAYS || durationDays > ContractsService.FREEZE_MAX_DAYS) {
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
        data: { status: 'PAUSED' },
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
    const nextStatus = this.deriveContractStatus('ACTIVE', existing.serviceStartDate, existing.serviceEndDate);
    const updated = await this.prisma.contractDocument.update({
      where: { id: contractId },
      data: {
        status: nextStatus,
      },
      select: { id: true, status: true },
    });
    await this.refreshClientStatus(existing.clientId);
    this.logger.warn(
      `AUDIT contract.resume reqId=${this.requestContext.getRequestId()} contractId=${contractId} clientId=${existing.clientId}`,
    );
    return updated;
  }

  async terminate(contractId: string) {
    const existing = await this.prisma.contractDocument.findUnique({
      where: { id: contractId },
      select: { id: true, clientId: true },
    });
    if (!existing) throw new NotFoundException('Contract not found');
    const updated = await this.prisma.contractDocument.update({
      where: { id: contractId },
      data: { status: 'CANCELLED' },
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
    const [paidAgg, refundedAgg] = await this.prisma.$transaction([
      this.prisma.payment.aggregate({
        where: {
          contractDocumentId: contractId,
          operationType: PaymentOperationType.SALE,
          status: PaymentStatus.PAID,
        },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
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

    await this.prisma.$transaction(async (tx) => {
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
        data: { status: 'CANCELLED' },
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

    const guard = await this.canCreateContractForClient(clientId, dto.contractNumber);
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

    const serviceStartDate = this.toDate(dto.serviceStartDate);
    const serviceEndDate = this.toDate(dto.serviceEndDate);
    if (serviceStartDate && serviceEndDate && serviceEndDate < serviceStartDate) {
      throw new BadRequestException(this.errors.serviceDateRangeInvalid);
    }
    const initialStatus = this.deriveContractStatus('ACTIVE', serviceStartDate, serviceEndDate);
    const pdfBytes = await this.generate(dto);
    let created: { id: string; contractNumber: string; createdAt: Date };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const contract = await tx.contractDocument.create({
          data: {
            clientId,
            contractNumber: dto.contractNumber ?? '',
            status: initialStatus,
            contractDate: this.toDate(dto.contractDate),
            serviceStartDate,
            serviceEndDate,
            servicePrice,
            payload: dto as unknown as object,
          },
          select: { id: true, contractNumber: true, createdAt: true },
        });

        await tx.payment.create({
          data: {
            clientId,
            contractDocumentId: contract.id,
            amount: servicePrice,
            status: PaymentStatus.PAID,
            operationType: PaymentOperationType.SALE,
            paidAt: new Date(),
            processedById: actorId,
            comment: 'Auto payment on contract save',
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
