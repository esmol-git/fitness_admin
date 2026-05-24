import { IsString, MinLength } from 'class-validator';

export class StaffCodeDto {
  @IsString()
  @MinLength(1)
  code!: string;
}
