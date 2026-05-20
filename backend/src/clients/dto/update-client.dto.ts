import { ClientStatus, Gender } from '@prisma/client';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateClientDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  middleName?: string | null;

  @IsOptional()
  @IsDateString()
  birthDate?: string | null;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender | null;

  @IsOptional()
  @IsEnum(ClientStatus)
  status?: ClientStatus;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  passport?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  passportIssuedBy?: string | null;

  @IsOptional()
  @IsDateString()
  passportIssuedAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;

  @IsOptional()
  @IsString()
  managerId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  contractNumber?: string | null;

  @IsOptional()
  @IsDateString()
  contractStartDate?: string | null;

  @IsOptional()
  @IsDateString()
  contractEndDate?: string | null;

  @IsOptional()
  @IsDateString()
  paymentDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  membershipType?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  cardNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  accessKey?: string | null;

  @IsOptional()
  @IsString()
  photoUrl?: string | null;
}
