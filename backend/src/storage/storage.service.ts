import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly s3: S3Client;
  private readonly bucket: string | null;
  private readonly publicBaseUrl: string | null;

  constructor(private readonly config: ConfigService) {
    const region = this.config.get<string>('S3_REGION') ?? 'eu-central-1';
    this.bucket = this.config.get<string>('S3_BUCKET') ?? null;
    this.publicBaseUrl = this.config.get<string>('S3_PUBLIC_BASE_URL') ?? null;

    this.s3 = new S3Client({
      region,
      credentials: this.config.get<string>('S3_ACCESS_KEY_ID')
        ? {
            accessKeyId: this.config.get<string>('S3_ACCESS_KEY_ID') as string,
            secretAccessKey: this.config.get<string>('S3_SECRET_ACCESS_KEY') as string,
          }
        : undefined,
      endpoint: this.config.get<string>('S3_ENDPOINT') ?? undefined,
      forcePathStyle: this.config.get<string>('S3_FORCE_PATH_STYLE') === 'true',
    });
  }

  isConfigured() {
    return Boolean(this.bucket);
  }

  async onModuleInit() {
    await this.ensureBucket();
  }

  private async ensureBucket() {
    if (!this.bucket) return;
    try {
      await this.s3.send(
        new HeadBucketCommand({
          Bucket: this.bucket,
        }),
      );
    } catch {
      await this.s3.send(
        new CreateBucketCommand({
          Bucket: this.bucket,
        }),
      );
    }
  }

  /** Presigned PUT для загрузки из браузера (аватар клиента и т.п.). */
  async presignPutObject(key: string, contentType: string, expiresInSeconds = 900) {
    if (!this.bucket) {
      throw new BadRequestException({
        code: 'STORAGE_NOT_CONFIGURED',
        message: 'S3 bucket is not configured',
      });
    }
    await this.ensureBucket();
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: expiresInSeconds });
    const publicUrl = this.publicBaseUrl
      ? `${this.publicBaseUrl.replace(/\/+$/, '')}/${key}`
      : null;
    return { uploadUrl, key, publicUrl };
  }

  async uploadPdf(key: string, bytes: Uint8Array) {
    if (!this.bucket) {
      return { key: null, url: null };
    }
    await this.ensureBucket();

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: 'application/pdf',
      }),
    );

    const url = this.publicBaseUrl
      ? `${this.publicBaseUrl.replace(/\/+$/, '')}/${key}`
      : `s3://${this.bucket}/${key}`;
    return { key, url };
  }

  async deleteObject(key: string) {
    if (!this.bucket || !key) return;
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async getReadUrl(key: string, expiresInSeconds = 300) {
    if (!this.bucket || !key) return null;
    await this.ensureBucket();
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  /**
   * Из URL вида `${S3_PUBLIC_BASE_URL}/${key}` (как при загрузке фото) получает S3 key.
   * Если URL не подходит под базу — null (внешняя ссылка или другой формат).
   */
  extractObjectKeyFromPublicUrl(objectUrl: string): string | null {
    if (!this.publicBaseUrl) return null;
    const base = this.publicBaseUrl.trim().replace(/\/+$/, '');
    const raw = objectUrl.trim();
    if (!base || !raw) return null;
    let objPath: string;
    let basePath: string;
    try {
      const ou = new URL(raw);
      objPath = `${ou.origin}${ou.pathname}`;
      const bu = new URL(base);
      basePath = `${bu.origin}${bu.pathname}`;
    } catch {
      return null;
    }
    if (!objPath.startsWith(basePath + '/')) return null;
    const key = objPath.slice(basePath.length + 1);
    return key.length > 0 ? key : null;
  }

  /**
   * Для приватного bucket: подписанный GET вместо «голого» URL (иначе MinIO отдаёт AccessDenied).
   * Если ключ извлечь нельзя — возвращаем исходный URL (например внешний аватар).
   */
  async presignGetUrlForStoredPublicUrl(
    storedUrl: string | null | undefined,
    expiresInSeconds = 604800,
  ): Promise<string | null> {
    if (storedUrl == null || typeof storedUrl !== 'string') return null;
    const trimmed = storedUrl.trim();
    if (!trimmed) return null;
    const key = this.extractObjectKeyFromPublicUrl(trimmed);
    if (!key) return trimmed;
    const signed = await this.getReadUrl(key, expiresInSeconds);
    return signed ?? trimmed;
  }

  async healthcheck() {
    if (!this.bucket) {
      return { configured: false, ok: true };
    }
    try {
      await this.s3.send(
        new HeadBucketCommand({
          Bucket: this.bucket,
        }),
      );
      return { configured: true, ok: true };
    } catch {
      return { configured: true, ok: false };
    }
  }
}
