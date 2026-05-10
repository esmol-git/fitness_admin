import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}
  private readonly errors = {
    invalidCredentials: { code: 'INVALID_CREDENTIALS', message: 'Invalid login or password' },
    invalidRefreshToken: { code: 'INVALID_REFRESH_TOKEN', message: 'Invalid or expired refresh token' },
  } as const;

  private normalizeLogin(login: string): string {
    return login.trim().toLowerCase();
  }

  private hashRefreshToken(raw: string): string {
    return createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  private async createRefreshSession(userId: string): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    const tokenHash = this.hashRefreshToken(raw);
    const days = Number(this.config.get<string>('JWT_REFRESH_DAYS') ?? '30');
    const expiresAt = new Date(
      Date.now() + Math.max(1, days) * 24 * 60 * 60 * 1000,
    );
    await this.prisma.refreshToken.create({
      data: { tokenHash, userId, expiresAt },
    });
    return raw;
  }

  private userPublic(user: {
    id: string;
    login: string;
    email: string | null;
    role: string;
    firstName: string | null;
    lastName: string | null;
  }) {
    return {
      id: user.id,
      login: user.login,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }

  async login(dto: LoginDto) {
    const login = this.normalizeLogin(dto.login);
    const password = dto.password.trim();
    const user = await this.prisma.user.findUnique({
      where: { login },
    });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException(this.errors.invalidCredentials);
    }
    const access_token = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
    });
    const refresh_token = await this.createRefreshSession(user.id);
    return {
      access_token,
      refresh_token,
      user: this.userPublic(user),
    };
  }

  async refresh(rawToken: string) {
    const tokenHash = this.hashRefreshToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (
      !existing ||
      existing.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException(this.errors.invalidRefreshToken);
    }

    await this.prisma.refreshToken.delete({ where: { id: existing.id } });

    const user = existing.user;
    const access_token = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
    });
    const refresh_token = await this.createRefreshSession(user.id);
    return {
      access_token,
      refresh_token,
      user: this.userPublic(user),
    };
  }

  async logout(rawToken: string) {
    const tokenHash = this.hashRefreshToken(rawToken);
    await this.prisma.refreshToken.deleteMany({ where: { tokenHash } });
    return { loggedOut: true };
  }
}
