import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

const CONTRACT_FILTER_STATUSES = ['SAVED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED'] as const;
const CONTRACT_DATE_FILTER_FIELDS = ['contractDate', 'serviceStartDate', 'serviceEndDate'] as const;

export class ListContractsQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  clientId?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsIn(CONTRACT_FILTER_STATUSES)
  status?: (typeof CONTRACT_FILTER_STATUSES)[number];

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsDateString()
  from?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsDateString()
  to?: string;

  /** По какому полю применять from/to (по умолчанию — дата заключения). */
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsIn(CONTRACT_DATE_FILTER_FIELDS)
  dateField?: (typeof CONTRACT_DATE_FILTER_FIELDS)[number];
}
