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
import { SkipThrottle } from '@nestjs/throttler';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { PaginationDto } from './dto/pagination.dto';
import { PresignClientPhotoDto } from './dto/presign-client-photo.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Controller('clients')
@UseGuards(RolesGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  findAll(@Query() query: PaginationDto) {
    return this.clientsService.findAll(query);
  }

  @Get('lookup')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  async lookup(@Query('code') code?: string) {
    const item = await this.clientsService.findByCardOrAccessCode(code ?? '');
    if (!item) {
      throw new NotFoundException({
        code: 'CLIENT_NOT_FOUND',
        message: 'Client not found',
      });
    }
    return item;
  }

  @Get('validate-card')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  async validateCard(
    @Query('cardNumber') cardNumber?: string,
    @Query('excludeId') excludeId?: string,
  ) {
    const available = await this.clientsService.isCardNumberAvailable(
      cardNumber ?? '',
      excludeId?.trim() || undefined,
    );
    return { available };
  }

  @Get('address-suggestions')
  @SkipThrottle()
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  async addressSuggestions(@Query('query') query?: string) {
    return this.clientsService.addressSuggestions(query ?? '');
  }

  /** Presigned PUT — загрузка файла на S3 до сохранения клиента (ключ clients/pending/…). */
  @Post('photo/upload-url')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  presignPhotoPending(@Body() dto: PresignClientPhotoDto) {
    return this.clientsService.presignClientPhotoUpload(null, dto.contentType);
  }

  @Post(':id/photo/upload-url')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  presignPhotoForClient(@Param('id') id: string, @Body() dto: PresignClientPhotoDto) {
    return this.clientsService.presignClientPhotoUpload(id, dto.contentType);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  findOne(@Param('id') id: string) {
    return this.clientsService.findOne(id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateClientDto) {
    return this.clientsService.create(dto, user.id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clientsService.update(id, dto, user.id);
  }

  @Patch(':id/block')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  block(@Param('id') id: string) {
    return this.clientsService.block(id);
  }

  @Patch(':id/unblock')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  unblock(@Param('id') id: string) {
    return this.clientsService.unblock(id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  remove(@Param('id') id: string) {
    return this.clientsService.remove(id);
  }
}
