import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CheckInDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4)
  @Matches(/^\d{1,4}$/, { message: 'Locker number must be 1 to 4 digits' })
  lockerNumber!: string;
}
