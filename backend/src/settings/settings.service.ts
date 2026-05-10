import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type AuthUser } from '../auth/decorators/current-user.decorator';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}
  private readonly errors = {
    settingsUserNotFound: { code: 'SETTINGS_USER_NOT_FOUND', message: 'Settings owner not found' },
  } as const;

  async getMySettings(user: AuthUser) {
    const [themeDefaults, dbUser] = await this.prisma.$transaction([
      this.prisma.themeSettings.findFirst({
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: {
          preferredTheme: true,
          preferredPreset: true,
          preferredLocale: true,
        },
      }),
    ]);

    return {
      themeMode: dbUser?.preferredTheme ?? 'SYSTEM',
      preset: dbUser?.preferredPreset ?? themeDefaults?.defaultPreset ?? 'blue',
      locale: dbUser?.preferredLocale ?? themeDefaults?.defaultLocale ?? 'ru',
    };
  }

  async updateMySettings(user: AuthUser, dto: UpdateSettingsDto) {
    let updated: { preferredTheme: string; preferredPreset: string; preferredLocale: string };
    try {
      updated = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          preferredTheme: dto.themeMode,
          preferredPreset: dto.preset,
          preferredLocale: dto.locale,
        },
        select: {
          preferredTheme: true,
          preferredPreset: true,
          preferredLocale: true,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException(this.errors.settingsUserNotFound);
      }
      throw error;
    }

    return {
      themeMode: updated.preferredTheme,
      preset: updated.preferredPreset,
      locale: updated.preferredLocale,
    };
  }
}
