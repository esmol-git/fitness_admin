import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateServiceStaffDto } from './dto/create-service-staff.dto';
import { ListServiceStaffQueryDto } from './dto/list-service-staff-query.dto';
import { UpdateServiceStaffDto } from './dto/update-service-staff.dto';
import { ServiceStaffService } from './service-staff.service';

@Controller('service-staff')
@UseGuards(RolesGuard)
export class ServiceStaffController {
  constructor(private readonly serviceStaffService: ServiceStaffService) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  findAll(@Query() query: ListServiceStaffQueryDto) {
    return this.serviceStaffService.findAll(query);
  }

  @Get('lookup')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  async lookup(@Query('code') code?: string) {
    const item = await this.serviceStaffService.findByCardOrAccessCode(code ?? '');
    if (!item) {
      throw new NotFoundException({
        code: 'SERVICE_STAFF_NOT_FOUND',
        message: 'Service staff not found',
      });
    }
    return item;
  }

  @Get('validate-card')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  async validateCard(@Query('cardNumber') cardNumber?: string, @Query('excludeId') excludeId?: string) {
    const available = await this.serviceStaffService.isCardNumberAvailable(
      cardNumber ?? '',
      excludeId?.trim() || undefined,
    );
    return { available };
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  findOne(@Param('id') id: string) {
    return this.serviceStaffService.findOne(id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  create(@Body() dto: CreateServiceStaffDto) {
    return this.serviceStaffService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  update(@Param('id') id: string, @Body() dto: UpdateServiceStaffDto) {
    return this.serviceStaffService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  remove(@Param('id') id: string) {
    return this.serviceStaffService.remove(id);
  }
}
