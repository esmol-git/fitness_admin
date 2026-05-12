import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class GenerateContractDto {
  @IsString()
  @MaxLength(120)
  firstName!: string;

  @IsString()
  @MaxLength(120)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  middleName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  passportNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  passportIssuedBy?: string;

  @IsOptional()
  @IsDateString()
  passportIssuedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  serviceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  servicePrice?: string;

  @IsOptional()
  @IsDateString()
  contractDate?: string;

  @IsOptional()
  @IsDateString()
  serviceStartDate?: string;

  @IsOptional()
  @IsDateString()
  serviceEndDate?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contractNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  clubAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  executorRepresentative?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  executorName?: string;

  @IsOptional()
  @IsObject()
  extraFields?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  flatten?: boolean;

  /** FULL — одна оплата на полную сумму; рассрочка — первая оплата задаётся отдельно. */
  @IsOptional()
  @IsIn(['FULL', 'INSTALLMENT_FLEXIBLE', 'INSTALLMENT_EQUAL'])
  paymentPlan?: 'FULL' | 'INSTALLMENT_FLEXIBLE' | 'INSTALLMENT_EQUAL';

  /** Число равных частей (только для INSTALLMENT_EQUAL), минимум 2. */
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(120)
  installmentCount?: number;

  /** Сумма первого взноса при рассрочке (строка как у servicePrice). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  initialPaymentAmount?: string;
}
