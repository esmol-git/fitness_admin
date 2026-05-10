import { IsString, MaxLength, MinLength } from 'class-validator';

export class CheckInDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  lockerNumber!: string;
}
