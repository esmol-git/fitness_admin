import { ClientStatus, Gender } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationDto {
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
  @IsIn([...Object.values(ClientStatus), '__ALL_STATUSES__'])
  @Transform(({ value }) => (value === '' ? undefined : value))
  status?: ClientStatus | '__ALL_STATUSES__';

  @IsOptional()
  @IsIn([...Object.values(Gender), '__ALL_GENDERS__'])
  @Transform(({ value }) => (value === '' ? undefined : value))
  gender?: Gender | '__ALL_GENDERS__';

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value === '' ? undefined : value))
  membershipType?: string;

  @IsOptional()
  @IsIn(['IN_GYM', 'OUT_GYM', '__ALL_GYM__'])
  @Transform(({ value }) => (value === '' ? undefined : value))
  inGym?: 'IN_GYM' | 'OUT_GYM' | '__ALL_GYM__';

  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value === '' ? undefined : value))
  lastVisitFrom?: string;

  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value === '' ? undefined : value))
  lastVisitTo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  ageFrom?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  ageTo?: number;

  @IsOptional()
  @IsIn(['fullName', 'phone', 'createdAt', 'inGym', 'status', 'age', 'lastVisitAt'])
  sortBy?: 'fullName' | 'phone' | 'createdAt' | 'inGym' | 'status' | 'age' | 'lastVisitAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
