import { Transform } from 'class-transformer';
import { IsDateString, IsOptional } from 'class-validator';

export class ReportsQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsDateString()
  from?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsDateString()
  to?: string;
}
