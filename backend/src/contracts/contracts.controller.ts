import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CancelContractDto } from './dto/cancel-contract.dto';
import { FreezeContractDto } from './dto/freeze-contract.dto';
import { GenerateContractDto } from './dto/generate-contract.dto';
import { ListContractsQueryDto } from './dto/list-contracts-query.dto';
import { ContractsService } from './contracts.service';

@Controller('contracts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get('template-fields')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  getTemplateFields() {
    return this.contracts.getTemplateFields();
  }

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  listContracts(@Query() query: ListContractsQueryDto) {
    return this.contracts.listContracts(query);
  }

  @Post('sync-statuses')
  @Roles(Role.ADMIN, Role.MANAGER)
  syncStatusesNow() {
    return this.contracts.syncStatusesNow();
  }

  @Post('render-html')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async renderHtml(@Body() dto: GenerateContractDto) {
    return this.contracts.renderHtml(dto);
  }

  @Post('generate')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  async generate(@Body() dto: GenerateContractDto) {
    const pdfBytes = await this.contracts.generate(dto);
    return new StreamableFile(Buffer.from(pdfBytes), {
      type: 'application/pdf',
      disposition: 'inline; filename="contract.pdf"',
    });
  }

  @Get('client/:clientId')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  listClientContracts(@Param('clientId') clientId: string) {
    return this.contracts.listClientContracts(clientId);
  }

  @Get('client/:clientId/can-generate')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  canGenerateForClient(
    @Param('clientId') clientId: string,
    @Query('contractNumber') contractNumber?: string,
  ) {
    return this.contracts.canGenerateForClient(clientId, contractNumber);
  }

  @Post('client/:clientId/generate')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  async generateForClient(@Param('clientId') clientId: string) {
    const pdfBytes = await this.contracts.generateForClient(clientId);
    return new StreamableFile(Buffer.from(pdfBytes), {
      type: 'application/pdf',
      disposition: 'inline; filename="contract.pdf"',
    });
  }

  @Post('client/:clientId/:contractId/generate')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  async regenerateClientContract(
    @Param('clientId') clientId: string,
    @Param('contractId') contractId: string,
  ) {
    const pdfBytes = await this.contracts.regenerateClientContract(clientId, contractId);
    return new StreamableFile(Buffer.from(pdfBytes), {
      type: 'application/pdf',
      disposition: 'inline; filename="contract.pdf"',
    });
  }

  /** Сохраняет договор и PDF в хранилище; тело ответа — метаданные (без PDF в браузер). */
  @Post('client/:clientId/save')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  async saveClientContractFromForm(
    @CurrentUser() user: AuthUser,
    @Param('clientId') clientId: string,
    @Body() dto: GenerateContractDto,
  ) {
    const result = await this.contracts.saveClientContractFromForm(clientId, dto, user.id);
    return {
      id: result.id,
      contractNumber: result.contractNumber,
      createdAt: result.createdAt.toISOString(),
    };
  }

  @Patch(':contractId/status')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  updateStatus(@Param('contractId') contractId: string, @Body() dto: { status: string }) {
    return this.contracts.updateStatus(contractId, dto.status);
  }

  @Patch(':contractId/pause')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  pause(
    @CurrentUser() user: AuthUser,
    @Param('contractId') contractId: string,
    @Body() dto: FreezeContractDto,
  ) {
    return this.contracts.pause(contractId, dto, user.id);
  }

  @Patch(':contractId/resume')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  resume(@Param('contractId') contractId: string) {
    return this.contracts.resume(contractId);
  }

  @Patch(':contractId/terminate')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  terminate(@Param('contractId') contractId: string) {
    return this.contracts.terminate(contractId);
  }

  @Post(':contractId/cancel-with-refund')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  cancelWithRefund(
    @CurrentUser() user: AuthUser,
    @Param('contractId') contractId: string,
    @Body() dto: CancelContractDto,
  ) {
    return this.contracts.cancelWithRefund(contractId, dto, user.id);
  }

  @Delete(':contractId')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST)
  remove(@Param('contractId') contractId: string) {
    return this.contracts.remove(contractId);
  }

  @Get(':contractId/open-url')
  @Roles(Role.ADMIN, Role.MANAGER, Role.RECEPTIONIST, Role.TRAINER)
  getOpenUrl(@Param('contractId') contractId: string) {
    return this.contracts.getOpenUrl(contractId);
  }
}
