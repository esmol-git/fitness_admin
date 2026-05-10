import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'login must contain only letters, digits, dot, underscore or hyphen',
  })
  login!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
