import { ThemeMode } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsEnum(ThemeMode)
  themeMode?: ThemeMode;

  @IsOptional()
  @IsString()
  @IsIn(['blue', 'green', 'orange', 'purple', 'red', 'cyan'])
  preset?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ru', 'en'])
  locale?: string;
}
