import { IsString, MaxLength, MinLength } from 'class-validator';

export class CheckOutDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  code!: string;
}
