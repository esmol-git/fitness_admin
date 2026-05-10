import { IsIn, IsString } from 'class-validator';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export class PresignClientPhotoDto {
  @IsString()
  @IsIn([...ALLOWED])
  contentType!: (typeof ALLOWED)[number];
}
