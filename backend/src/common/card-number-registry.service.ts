import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type CardNumberOwnerExclude = {
  clientId?: string;
  staffId?: string;
};

@Injectable()
export class CardNumberRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  normalize(cardNumber: string) {
    return cardNumber.trim();
  }

  /** Card number must be unique across clients and service staff. */
  async isAvailable(cardNumber: string, exclude?: CardNumberOwnerExclude): Promise<boolean> {
    const normalized = this.normalize(cardNumber);
    if (!normalized) return true;

    const [client, staff] = await Promise.all([
      this.prisma.client.findUnique({
        where: { cardNumber: normalized },
        select: { id: true },
      }),
      this.prisma.serviceStaff.findFirst({
        where: { cardNumber: normalized },
        select: { id: true },
      }),
    ]);

    if (client && client.id !== exclude?.clientId) return false;
    if (staff && staff.id !== exclude?.staffId) return false;
    return true;
  }

  async assertAvailable(
    cardNumber: string,
    exclude?: CardNumberOwnerExclude,
    error: { code: string; message: string } = {
      code: 'CARD_NUMBER_EXISTS',
      message: 'Card number already exists',
    },
  ) {
    if (!(await this.isAvailable(cardNumber, exclude))) {
      throw new ConflictException(error);
    }
  }
}
