import { Module } from '@nestjs/common';
import { MembershipCatalogController } from './membership-catalog.controller';
import { MembershipCatalogService } from './membership-catalog.service';

@Module({
  controllers: [MembershipCatalogController],
  providers: [MembershipCatalogService],
})
export class MembershipCatalogModule {}
