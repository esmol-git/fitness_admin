import { PaymentChannel, PaymentStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreatePaymentDto {
  @IsString()
  clientId!: string;

  @IsOptional()
  @IsString()
  contractDocumentId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsEnum(PaymentChannel)
  channel?: PaymentChannel;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
