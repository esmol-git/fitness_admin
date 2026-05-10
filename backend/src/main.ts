import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

/** Лимит JSON (фото в карточке клиента как data URL сильно раздувает PATCH). По умолчанию Express ~100kb → 413. */
const JSON_BODY_LIMIT = '15mb';

const bootstrapLogger = new Logger('Bootstrap');

function assertProductionSecurityConfig(config: ConfigService) {
  const nodeEnv = (config.get<string>('NODE_ENV') ?? 'development').trim().toLowerCase();
  if (nodeEnv !== 'production') return;

  const accessSecret = (config.get<string>('JWT_ACCESS_SECRET') ?? '').trim();
  const cookieSecure = (config.get<string>('COOKIE_SECURE') ?? '').trim().toLowerCase() === 'true';
  const corsOrigin = (config.get<string>('CORS_ORIGIN') ?? '').trim();

  const errors: string[] = [];
  if (!accessSecret || accessSecret === 'change-me-access') {
    errors.push('JWT_ACCESS_SECRET must be set to a strong non-default value');
  }
  if (!cookieSecure) {
    errors.push('COOKIE_SECURE must be true in production');
  }
  if (!corsOrigin) {
    errors.push('CORS_ORIGIN must contain at least one allowed origin in production');
  }

  if (errors.length > 0) {
    throw new Error(`Security configuration error: ${errors.join('; ')}`);
  }
}

function logSecurityProfile(config: ConfigService) {
  const nodeEnv = (config.get<string>('NODE_ENV') ?? 'development').trim().toLowerCase();
  const cookieSecure = (config.get<string>('COOKIE_SECURE') ?? '').trim().toLowerCase() === 'true';
  const corsOrigin = (config.get<string>('CORS_ORIGIN') ?? '').trim();
  const corsOrigins = corsOrigin
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const hasAccessSecret = (config.get<string>('JWT_ACCESS_SECRET') ?? '').trim().length > 0;
  const accessSecretLooksDefault =
    (config.get<string>('JWT_ACCESS_SECRET') ?? '').trim() === 'change-me-access';

  bootstrapLogger.log(
    `Security profile env=${nodeEnv} cookieSecure=${cookieSecure} corsOrigins=${corsOrigins.length} jwtAccessSecretSet=${hasAccessSecret} jwtAccessSecretDefault=${accessSecretLooksDefault}`,
  );

  if (nodeEnv !== 'production') return;
  if (!cookieSecure) {
    bootstrapLogger.warn('COOKIE_SECURE is false in production');
  }
  if (corsOrigins.length === 0) {
    bootstrapLogger.warn('CORS_ORIGIN is empty in production');
  }
  if (!hasAccessSecret || accessSecretLooksDefault) {
    bootstrapLogger.warn('JWT_ACCESS_SECRET is missing or default in production');
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.use(json({ limit: JSON_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  assertProductionSecurityConfig(config);
  logSecurityProfile(config);
  const corsOrigin = config.get<string>('CORS_ORIGIN') ?? '';
  const corsOrigins = corsOrigin
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  app.setGlobalPrefix('api');
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
  });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      validationError: { target: false, value: false },
    }),
  );
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
