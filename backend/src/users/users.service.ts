import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { type AuthUser } from '../auth/decorators/current-user.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { PaginationDto } from './dto/pagination.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}
  private readonly errors = {
    loginOrEmailExists: { code: 'LOGIN_OR_EMAIL_EXISTS', message: 'Login or email already exists' },
    userNotFound: { code: 'USER_NOT_FOUND', message: 'User not found' },
    cannotDeleteSelf: { code: 'CANNOT_DELETE_SELF', message: 'Cannot delete your own account' },
    managerRoleForbidden: { code: 'MANAGER_ROLE_FORBIDDEN', message: 'Manager can only assign RECEPTIONIST role' },
  } as const;

  private formatDateOnly(value: Date | null | undefined): string | null {
    if (!value) return null;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private sanitizeUser(user: {
    id: string;
    login: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    birthDate: Date | null;
    position: string | null;
    role: Role;
    phone: string | null;
    salary: Prisma.Decimal | null;
    isEmployee: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      ...user,
      birthDate: this.formatDateOnly(user.birthDate),
      salary: user.salary ? Number(user.salary) : null,
    };
  }

  private assertManagerPermissions(actor: AuthUser, role?: Role) {
    if (actor.role !== Role.MANAGER) return;
    if (role && role !== Role.RECEPTIONIST) {
      throw new ForbiddenException(this.errors.managerRoleForbidden);
    }
  }

  async findAll(query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();
    const roleFilter =
      query.role && query.role !== '__ALL_ROLES__' ? query.role : undefined;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { login: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { position: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    if (roleFilter) {
      where.role = roleFilter;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          login: true,
          email: true,
          firstName: true,
          lastName: true,
          birthDate: true,
          position: true,
          role: true,
          phone: true,
          salary: true,
          isEmployee: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((item) => this.sanitizeUser(item)),
      meta: { total, page, limit },
    };
  }

  async create(actor: AuthUser, dto: CreateUserDto) {
    this.assertManagerPermissions(actor, dto.role);
    const role = dto.role ?? Role.RECEPTIONIST;
    this.assertManagerPermissions(actor, role);

    const password = await bcrypt.hash(dto.password, 10);
    const login = dto.login.trim().toLowerCase();
    const email =
      dto.email?.trim() && dto.email.trim().length > 0
        ? dto.email.trim()
        : null;
    try {
      const user = await this.prisma.user.create({
        data: {
          login,
          email,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          birthDate: dto.birthDate
            ? new Date(`${dto.birthDate}T12:00:00.000Z`)
            : undefined,
          position: dto.position?.trim() || null,
          password,
          role,
          phone: dto.phone,
          salary: dto.salary,
          isEmployee: dto.isEmployee ?? true,
        },
        select: {
          id: true,
          login: true,
          email: true,
          firstName: true,
          lastName: true,
          birthDate: true,
          position: true,
          role: true,
          phone: true,
          salary: true,
          isEmployee: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return this.sanitizeUser(user);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(this.errors.loginOrEmailExists);
      }
      throw error;
    }
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserDto) {
    if (dto.role) {
      this.assertManagerPermissions(actor, dto.role);
    }

    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(this.errors.userNotFound);
    }

    const data: Prisma.UserUpdateInput = {
      role: dto.role,
      phone: dto.phone,
      salary: dto.salary,
      isEmployee: dto.isEmployee,
    };

    if (dto.login !== undefined) {
      data.login = dto.login.trim().toLowerCase();
    }
    if (dto.email !== undefined) {
      const e = dto.email;
      data.email =
        e === null || (typeof e === 'string' && e.trim() === '')
          ? null
          : String(e).trim();
    }

    if (dto.firstName !== undefined) {
      data.firstName = dto.firstName.trim();
    }
    if (dto.lastName !== undefined) {
      data.lastName = dto.lastName.trim();
    }
    if (dto.birthDate !== undefined) {
      data.birthDate = dto.birthDate
        ? new Date(`${dto.birthDate}T12:00:00.000Z`)
        : null;
    }
    if (dto.position !== undefined) {
      data.position = dto.position?.trim() ? dto.position.trim() : null;
    }

    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id },
        data,
        select: {
          id: true,
          login: true,
          email: true,
          firstName: true,
          lastName: true,
          birthDate: true,
          position: true,
          role: true,
          phone: true,
          salary: true,
          isEmployee: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return this.sanitizeUser(updated);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(this.errors.loginOrEmailExists);
      }
      throw error;
    }
  }

  async remove(actor: AuthUser, id: string) {
    if (actor.id === id) {
      throw new ForbiddenException(this.errors.cannotDeleteSelf);
    }
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(this.errors.userNotFound);
    }
    await this.prisma.user.delete({ where: { id } });
    return { deleted: true };
  }
}
