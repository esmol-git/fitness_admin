import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [PrismaModule, StorageModule, ContractsModule],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
