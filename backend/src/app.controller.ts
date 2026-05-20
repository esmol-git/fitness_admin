import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './auth/decorators/public.decorator';
import { PrismaService } from './prisma/prisma.service';
import { StorageService } from './storage/storage.service';
import { AppService } from './app.service';

@Controller()
@Public()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  getHello(): { message: string } {
    return this.appService.getHello();
  }

  @Get('health/live')
  @SkipThrottle()
  getLiveness() {
    return { ok: true, service: 'backend' };
  }

  @Get('health/ready')
  @SkipThrottle()
  async getReadiness() {
    let dbOk = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }

    const storageStatus = await this.storage.healthcheck();
    const storageOk = storageStatus.ok;
    const ok = dbOk && storageOk;

    const payload = {
      ok,
      checks: {
        db: dbOk,
        storage: storageOk,
      },
      storageConfigured: storageStatus.configured,
      timestamp: new Date().toISOString(),
    };
    if (!ok) {
      throw new ServiceUnavailableException(payload);
    }
    return payload;
  }
}
