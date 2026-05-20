import { IsDateString, IsOptional } from 'class-validator';

/** Запуск ожидающего договора: менеджер задаёт дату начала оказания услуги. */
export class ActivateContractDto {
  @IsDateString()
  serviceStartDate!: string;

  @IsOptional()
  @IsDateString()
  serviceEndDate?: string;
}
