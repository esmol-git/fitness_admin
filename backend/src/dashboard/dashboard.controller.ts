import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(RolesGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @Roles(Role.ADMIN, Role.MANAGER)
  getSummary() {
    return this.dashboard.getSummary();
  }

  @Get('charts')
  @Roles(Role.ADMIN, Role.MANAGER)
  getCharts() {
    return this.dashboard.getCharts();
  }

  @Get('alerts')
  @Roles(Role.ADMIN, Role.MANAGER)
  getAlerts() {
    return this.dashboard.getAlerts();
  }
}
