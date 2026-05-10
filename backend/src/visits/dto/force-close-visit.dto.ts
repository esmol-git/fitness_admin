import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const FORCE_CLOSE_REASONS = ['LOST_KEY', 'FOUND_LATER', 'ADMIN_CORRECTION'] as const;

export class ForceCloseVisitDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  code!: string;

  @IsEnum(FORCE_CLOSE_REASONS)
  reason!: (typeof FORCE_CLOSE_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
