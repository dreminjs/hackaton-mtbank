import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AVAILABLE_CASHBACK_CATEGORIES,
  PARTNER_OFFERS,
} from './loyalty.constants';
import type { SelectCashbackCategoriesDto } from './loyalty.dto';

@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Получить баланс Мобиков, список доступных акций партнеров и купленные промокоды
   */
  async getOffers(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        mobiksBalance: true,
        rewardPurchases: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    return {
      mobiksBalance: user.mobiksBalance,
      offers: PARTNER_OFFERS,
      purchasedRewards: user.rewardPurchases,
    };
  }

  /**
   * Покупка акции партнера за Мобики
   */
  async redeemOffer(userId: string, offerId: string) {
    const offer = PARTNER_OFFERS.find((o) => o.id === offerId);
    if (!offer) {
      throw new NotFoundException(`Акция партнера с ID "${offerId}" не найдена`);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mobiksBalance: true },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    if (user.mobiksBalance < offer.cost) {
      throw new BadRequestException(
        `Недостаточно Мобиков для покупки. Требуется: ${offer.cost} ⚡, доступно: ${user.mobiksBalance} ⚡`,
      );
    }

    // Генерируем уникальный читаемый промокод
    const randomHex = Math.random().toString(36).substring(2, 6).toUpperCase();
    const cleanPartnerPrefix = offer.partnerName
      .replace(/[^a-zA-Zа-яА-Я0-9]/g, '')
      .slice(0, 4)
      .toUpperCase();
    const promoCode = `MOBY-${cleanPartnerPrefix || 'REWD'}-${randomHex}`;

    // Списываем Мобики и фиксируем покупку в атомарной транзакции
    const [updatedUser, purchase] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          mobiksBalance: { decrement: offer.cost },
        },
        select: { mobiksBalance: true },
      }),
      this.prisma.partnerRewardPurchase.create({
        data: {
          userId,
          offerId: offer.id,
          title: offer.title,
          partnerName: offer.partnerName,
          cost: offer.cost,
          promoCode,
        },
      }),
    ]);

    return {
      message: `Сертификат «${offer.title}» (${offer.partnerName}) успешно получен за ${offer.cost} Мобиков!`,
      mobiksBalance: updatedUser.mobiksBalance,
      spentMobiks: offer.cost,
      purchasedReward: purchase,
    };
  }

  /**
   * Получить список всех доступных категорий повышенного кэшбэка и текущий выбор
   */
  async getCashbackCategories(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { selectedCashbackCategories: true },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    return {
      selectedCategories: user.selectedCashbackCategories || [],
      availableCategories: AVAILABLE_CASHBACK_CATEGORIES,
    };
  }

  /**
   * Выбор категорий повышенного кэшбэка (до 2 штук)
   */
  async selectCashbackCategories(
    userId: string,
    dto: SelectCashbackCategoriesDto,
  ) {
    if (dto.categories.length > 2) {
      throw new BadRequestException(
        'Можно выбрать не более 2 категорий повышенного кэшбэка на месяц',
      );
    }

    const validCodes = new Set(
      AVAILABLE_CASHBACK_CATEGORIES.map((c) => c.code),
    );
    for (const cat of dto.categories) {
      if (!validCodes.has(cat)) {
        throw new BadRequestException(
          `Неизвестная категория: "${cat}". Допустимые: ${Array.from(validCodes).join(', ')}`,
        );
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        selectedCashbackCategories: dto.categories,
      },
      select: {
        selectedCashbackCategories: true,
      },
    });

    return {
      message: 'Категории повышенного кэшбэка на месяц успешно сохранены! За покупки в этих категориях вы будете получать x2 Мобиков.',
      selectedCategories: updatedUser.selectedCashbackCategories,
    };
  }
}
