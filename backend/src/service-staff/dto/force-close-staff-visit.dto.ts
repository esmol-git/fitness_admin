import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { StaffCodeDto } from './staff-code.dto';

export class ForceCloseStaffVisitDto extends StaffCodeDto {
  @IsIn(['LOST_KEY', 'FOUND_LATER', 'ADMIN_CORRECTION'])
  reason!: 'LOST_KEY' | 'FOUND_LATER' | 'ADMIN_CORRECTION';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
