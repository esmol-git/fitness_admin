import { ServiceStaffStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListServiceStaffQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value === '' ? undefined : value))
  search?: string;

  @IsOptional()
  @IsEnum(ServiceStaffStatus)
  @Transform(({ value }) => (value === '' ? undefined : value))
  status?: ServiceStaffStatus;

  @IsOptional()
  @IsIn(['IN_GYM', 'OUT_GYM', '__ALL_GYM__'])
  @Transform(({ value }) => (value === '' ? undefined : value))
  inGym?: 'IN_GYM' | 'OUT_GYM' | '__ALL_GYM__';

  @IsOptional()
  @IsIn(['fullName', 'phone', 'cardNumber', 'position', 'createdAt', 'status'])
  sortBy?: 'fullName' | 'phone' | 'cardNumber' | 'position' | 'createdAt' | 'status';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
