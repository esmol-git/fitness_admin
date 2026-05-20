import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import type { Request, Response } from 'express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  CurrentUser,
  type AuthUser,
} from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RolesGuard } from './guards/roles.guard';
import { AuthService } from './auth.service';

@Controller('auth')
@SkipThrottle()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private getCookieOptions() {
    const secure = this.config.get<string>('COOKIE_SECURE') === 'true';
    return {
      httpOnly: true,
      secure,
      sameSite: 'lax' as const,
      path: '/api/auth',
      maxAge:
        Math.max(1, Number(this.config.get<string>('JWT_REFRESH_DAYS') ?? '30')) *
        24 *
        60 *
        60 *
        1000,
    };
  }

  @Post('login')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60 * 1000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto);
    res.cookie('refresh_token', result.refresh_token, this.getCookieOptions());
    return {
      access_token: result.access_token,
      user: result.user,
    };
  }

  @Post('refresh')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  async refresh(
    @Req() req: Request,
    @Body() dto: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawRefresh =
      req.cookies?.refresh_token ??
      (dto.refreshToken && dto.refreshToken.length > 0 ? dto.refreshToken : null);
    if (!rawRefresh) {
      throw new UnauthorizedException({
        code: 'MISSING_REFRESH_TOKEN',
        message: 'Missing refresh token',
      });
    }
    const result = await this.auth.refresh(rawRefresh);
    res.cookie('refresh_token', result.refresh_token, this.getCookieOptions());
    return {
      access_token: result.access_token,
      user: result.user,
    };
  }

  @Post('logout')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  async logout(
    @Req() req: Request,
    @Body() dto: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawRefresh =
      req.cookies?.refresh_token ??
      (dto.refreshToken && dto.refreshToken.length > 0 ? dto.refreshToken : '');
    if (rawRefresh) {
      await this.auth.logout(rawRefresh);
    }
    res.clearCookie('refresh_token', this.getCookieOptions());
    return { loggedOut: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  /** Проверка RBAC (только ADMIN) — для отладки и тестов фронта */
  @Get('admin/ping')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  adminPing() {
    return { ok: true, scope: 'admin' };
  }
}
