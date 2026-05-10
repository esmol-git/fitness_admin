import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateMembershipCatalogItemDto } from './dto/create-membership-catalog-item.dto';
import { UpdateMembershipCatalogItemDto } from './dto/update-membership-catalog-item.dto';
import { MembershipCatalogService } from './membership-catalog.service';

@Controller('membership-catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MembershipCatalogController {
  constructor(
    private readonly membershipCatalogService: MembershipCatalogService,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  findAll() {
    return this.membershipCatalogService.findAll();
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  create(@Body() dto: CreateMembershipCatalogItemDto) {
    return this.membershipCatalogService.create(dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  remove(@Param('id') id: string) {
    return this.membershipCatalogService.remove(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  update(@Param('id') id: string, @Body() dto: UpdateMembershipCatalogItemDto) {
    return this.membershipCatalogService.update(id, dto);
  }
}
