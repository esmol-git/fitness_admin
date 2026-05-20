import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMembershipCatalogItemDto } from './dto/create-membership-catalog-item.dto';
import { ListMembershipCatalogQueryDto } from './dto/list-membership-catalog-query.dto';
import { UpdateMembershipCatalogItemDto } from './dto/update-membership-catalog-item.dto';

@Injectable()
export class MembershipCatalogService {
  constructor(private readonly prisma: PrismaService) {}
  private readonly errors = {
    membershipExists: { code: 'MEMBERSHIP_EXISTS', message: 'Membership already exists' },
    membershipNotFound: { code: 'MEMBERSHIP_NOT_FOUND', message: 'Membership not found' },
  } as const;

  findAll(query?: ListMembershipCatalogQueryDto) {
    return this.prisma.membershipCatalog.findMany({
      where: query?.activeOnly === true ? { isActive: true } : undefined,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async create(dto: CreateMembershipCatalogItemDto) {
    try {
      return await this.prisma.membershipCatalog.create({
        data: {
          name: dto.name.trim(),
          price: dto.price != null ? new Prisma.Decimal(dto.price) : null,
          durationValue: dto.durationValue ?? null,
          durationUnit: dto.durationUnit ?? null,
          description: this.nullable(dto.description),
          isActive: dto.isActive ?? true,
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(this.errors.membershipExists);
      }
      throw error;
    }
  }

  async remove(id: string) {
    const existing = await this.prisma.membershipCatalog.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(this.errors.membershipNotFound);
    await this.prisma.membershipCatalog.update({
      where: { id },
      data: { isActive: false },
    });
    return { ok: true };
  }

  async update(id: string, dto: UpdateMembershipCatalogItemDto) {
    const existing = await this.prisma.membershipCatalog.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(this.errors.membershipNotFound);
    try {
      const updated = await this.prisma.membershipCatalog.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.durationValue !== undefined
            ? { durationValue: dto.durationValue ?? null }
            : {}),
          ...(dto.durationUnit !== undefined
            ? { durationUnit: dto.durationUnit ?? null }
            : {}),
          ...(dto.price !== undefined
            ? { price: dto.price == null ? null : new Prisma.Decimal(dto.price) }
            : {}),
          ...(dto.description !== undefined
            ? { description: this.nullable(dto.description) }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      return updated;
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(this.errors.membershipExists);
      }
      throw error;
    }
  }

  private nullable(value?: string | null) {
    if (value == null) return null;
    const next = value.trim();
    return next.length > 0 ? next : null;
  }
}
