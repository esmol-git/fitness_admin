import { RefundMethod } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CancelContractDto {
  @Transform(({ value }) => (typeof value === 'string' ? Number(value.replace(',', '.')) : value))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  refundAmount!: number;

  @IsOptional()
  @IsEnum(RefundMethod)
  refundMethod?: RefundMethod;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  comment?: string;
}
