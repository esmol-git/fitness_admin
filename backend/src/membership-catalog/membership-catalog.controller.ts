import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateMembershipCatalogItemDto } from './dto/create-membership-catalog-item.dto';
import { ListMembershipCatalogQueryDto } from './dto/list-membership-catalog-query.dto';
import { UpdateMembershipCatalogItemDto } from './dto/update-membership-catalog-item.dto';
import { MembershipCatalogService } from './membership-catalog.service';

@Controller('membership-catalog')
@UseGuards(RolesGuard)
export class MembershipCatalogController {
  constructor(
    private readonly membershipCatalogService: MembershipCatalogService,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  findAll(@Query() query: ListMembershipCatalogQueryDto) {
    return this.membershipCatalogService.findAll(query);
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
