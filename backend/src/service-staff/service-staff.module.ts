import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ServiceStaffController } from './service-staff.controller';
import { ServiceStaffService } from './service-staff.service';
import { ServiceStaffVisitsController } from './service-staff-visits.controller';
import { ServiceStaffVisitsService } from './service-staff-visits.service';

@Module({
  imports: [StorageModule],
  controllers: [ServiceStaffController, ServiceStaffVisitsController],
  providers: [ServiceStaffService, ServiceStaffVisitsService],
  exports: [ServiceStaffService, ServiceStaffVisitsService],
})
export class ServiceStaffModule {}
