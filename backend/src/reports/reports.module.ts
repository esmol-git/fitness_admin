import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [ContractsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
