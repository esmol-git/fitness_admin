import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

const CONTRACT_FILTER_STATUSES = ['SAVED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED'] as const;

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
}
