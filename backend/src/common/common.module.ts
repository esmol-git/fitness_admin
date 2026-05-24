import { Global, Module } from '@nestjs/common';
import { CardNumberRegistryService } from './card-number-registry.service';
import { RequestContextService } from './request-context.service';

@Global()
@Module({
  providers: [RequestContextService, CardNumberRegistryService],
  exports: [RequestContextService, CardNumberRegistryService],
})
export class CommonModule {}
