import { MembershipDurationUnit } from '@prisma/client';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateMembershipCatalogItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  durationValue?: number;

  @IsOptional()
  @IsEnum(MembershipDurationUnit)
  durationUnit?: MembershipDurationUnit;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;
}
