import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const LIST_STAFF_VISITS_SORT_BY = ['enteredAt', 'exitedAt', 'status', 'staffLastName'] as const;
export type ListStaffVisitsSortBy = (typeof LIST_STAFF_VISITS_SORT_BY)[number];

export class ListStaffVisitsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  staffId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value === '' ? undefined : value))
  from?: string;

  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value === '' ? undefined : value))
  to?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value === '' ? undefined : value))
  state?: 'IN_GYM' | 'LEFT' | 'OVERDUE' | 'FORCE_CLOSED';

  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value === undefined || value === null) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : value;
  })
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value === undefined || value === null) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : value;
  })
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  @IsIn([...LIST_STAFF_VISITS_SORT_BY])
  sortBy?: ListStaffVisitsSortBy;

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
