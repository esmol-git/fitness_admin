import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [ContractsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
