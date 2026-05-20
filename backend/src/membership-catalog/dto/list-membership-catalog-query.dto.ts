import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class ListMembershipCatalogQueryDto {
  /** Если true — только активные (для выбора в формах). Без параметра — весь справочник. */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return undefined;
  })
  @IsBoolean()
  activeOnly?: boolean;
}
