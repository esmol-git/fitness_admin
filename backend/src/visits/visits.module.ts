import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { ContractsModule } from '../contracts/contracts.module';

@Module({
  imports: [PrismaModule, StorageModule, ContractsModule],
  controllers: [VisitsController],
  providers: [VisitsService],
})
export class VisitsModule {}
