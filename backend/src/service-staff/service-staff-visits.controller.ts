import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ForceCloseStaffVisitDto } from './dto/force-close-staff-visit.dto';
import { ListStaffVisitsQueryDto } from './dto/list-staff-visits-query.dto';
import { StaffCodeDto } from './dto/staff-code.dto';
import { ServiceStaffVisitsService } from './service-staff-visits.service';

@Controller('service-staff-visits')
@UseGuards(RolesGuard)
export class ServiceStaffVisitsController {
  constructor(private readonly staffVisitsService: ServiceStaffVisitsService) {}

  @Get('lookup')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  lookup(@Query('code') code?: string, @Query('staffId') staffId?: string) {
    return this.staffVisitsService.lookup({ code, staffId });
  }

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  list(@Query() query: ListStaffVisitsQueryDto) {
    return this.staffVisitsService.list(query);
  }

  @Post('check-in')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  checkIn(@CurrentUser() user: AuthUser, @Body() dto: StaffCodeDto) {
    return this.staffVisitsService.checkIn(dto.code, user.id);
  }

  @Post('check-out')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  checkOut(@CurrentUser() user: AuthUser, @Body() dto: StaffCodeDto) {
    return this.staffVisitsService.checkOut(dto.code, user.id);
  }

  @Post('force-close')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  forceClose(@CurrentUser() user: AuthUser, @Body() dto: ForceCloseStaffVisitDto) {
    return this.staffVisitsService.forceClose(dto.code, dto.reason, user.id, dto.comment);
  }
}
