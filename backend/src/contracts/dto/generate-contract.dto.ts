import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
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
}
