import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CheckInDto } from './dto/check-in.dto';
import { CheckOutDto } from './dto/check-out.dto';
import { ForceCloseVisitDto } from './dto/force-close-visit.dto';
import { ListVisitsQueryDto } from './dto/list-visits-query.dto';
import { VisitsService } from './visits.service';

@Controller('visits')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VisitsController {
  constructor(private readonly visitsService: VisitsService) {}

  @Get('lookup')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  lookup(@Query('code') code?: string) {
    return this.visitsService.lookup(code ?? '');
  }

  @Get('current')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  listCurrent() {
    return this.visitsService.listCurrent();
  }

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  list(@Query() query: ListVisitsQueryDto) {
    return this.visitsService.list(query);
  }

  @Post('check-in')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  checkIn(@CurrentUser() user: AuthUser, @Body() dto: CheckInDto) {
    return this.visitsService.checkIn(dto.code, dto.lockerNumber, user.id);
  }

  @Post('check-out')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  checkOut(@CurrentUser() user: AuthUser, @Body() dto: CheckOutDto) {
    return this.visitsService.checkOut(dto.code, user.id);
  }

  @Post('force-close')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  forceClose(@CurrentUser() user: AuthUser, @Body() dto: ForceCloseVisitDto) {
    return this.visitsService.forceClose(dto.code, dto.reason, user.id, dto.comment);
  }
}
