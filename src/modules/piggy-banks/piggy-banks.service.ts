import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePiggyBankDto,
  TopUpPiggyBankDto,
  UpdatePiggyBankDto,
  WithdrawPiggyBankDto,
} from './piggy-banks.dto';
import { isAdult } from '../../common/isAdult.helper';
import { generateCardNumber, toCardNumberMask } from '../../common/card-number.helper';
import { PiggyBankStatus, UserRole } from '#generated/prisma';

@Injectable()
export class PiggyBanksService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Форматирование сущности PiggyBank для ответа Swagger / UI
   */
  private formatPiggyBank(piggyBank: any) {
    const targetAmount = Number(piggyBank.targetAmount);
    const currentAmount = Number(piggyBank.currentAmount);
    const remainingAmount = Math.max(0, Number((targetAmount - currentAmount).toFixed(2)));
    const progressPercentage = targetAmount > 0
      ? Math.min(100, Math.round((currentAmount / targetAmount) * 100))
      : 0;

    return {
      id: piggyBank.id,
      title: piggyBank.title,
      description: piggyBank.description,
      targetAmount,
      currentAmount,
      remainingAmount,
      progressPercentage,
      isGoalReached: currentAmount >= targetAmount,
      targetDate: piggyBank.targetDate,
      status: piggyBank.status,
      owner: {
        id: piggyBank.owner.id,
        name: piggyBank.owner.name,
        phoneNumber: piggyBank.owner.phoneNumber,
        role: piggyBank.owner.role,
      },
      contributions: (piggyBank.contributions || []).map((c: any) => ({
        id: c.id,
        amount: Number(c.amount),
        comment: c.comment,
        createdAt: c.createdAt,
        user: {
          id: c.user.id,
          name: c.user.name,
          phoneNumber: c.user.phoneNumber,
          role: c.user.role,
        },
        cardNumberMask: c.card ? c.card.cardNumberMask : null,
      })),
      createdAt: piggyBank.createdAt,
      updatedAt: piggyBank.updatedAt,
    };
  }

  /**
   * Найти карту пользователя или выпустить виртуальную, если карт нет
   */
  private async getOrCreateCard(userId: string, cardId?: string) {
    if (cardId) {
      const card = await this.prisma.card.findFirst({
        where: { id: cardId, userId },
      });
      if (!card) {
        throw new NotFoundException('Указанная банковская карта не найдена');
      }
      return card;
    }

    const existingCard = await this.prisma.card.findFirst({
      where: { userId },
      orderBy: { id: 'asc' },
    });

    if (existingCard) {
      return existingCard;
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    const cardNumber = generateCardNumber();
    const defaultBalance =
      user.role === UserRole.CHILD_7_13 || user.role === UserRole.TEEN_14_17
        ? 50.0
        : 500.0;

    return this.prisma.card.create({
      data: {
        userId: user.id,
        cardNumber,
        cardNumberMask: toCardNumberMask(cardNumber),
        cardholderName: user.name.toUpperCase(),
        expiryDate: '10/29',
        type: 'VIRTUAL',
        balance: defaultBalance,
        dailyLimit: 100.0,
        spentToday: 0.0,
        allowOnlinePurchases: true,
        allowCashWithdrawal: true,
      },
    });
  }

  /**
   * Проверка: является ли пользователь ребенком (у родителя не может быть копилки)
   */
  private checkIsChild(user: any) {
    const isChild =
      user.role === UserRole.CHILD_7_13 ||
      user.role === UserRole.TEEN_14_17 ||
      !isAdult(new Date(user.birthDay));

    if (!isChild) {
      throw new BadRequestException(
        'Копилку может открыть только ребенок. Родители могут пополнять копилки своих детей.',
      );
    }
  }

  /**
   * Проверка родственной связи между пользователем и ребенком-владельцем копилки
   */
  private async verifyFamilyMember(userId: string, childId: string): Promise<boolean> {
    if (userId === childId) {
      return true; // Сам ребенок
    }

    // Проверяем: пользователь — родитель этого ребенка
    const asParent = await this.prisma.familyRelation.findUnique({
      where: {
        parentId_childId: {
          parentId: userId,
          childId: childId,
        },
      },
    });
    if (asParent) return true;

    // Проверяем: пользователь — брат или сестра (дети общих родителей)
    const childParents = await this.prisma.familyRelation.findMany({
      where: { childId },
      select: { parentId: true },
    });
    const parentIds = childParents.map((p) => p.parentId);

    if (parentIds.length > 0) {
      const isSibling = await this.prisma.familyRelation.findFirst({
        where: {
          parentId: { in: parentIds },
          childId: userId,
        },
      });
      if (isSibling) return true;
    }

    return false;
  }

  /**
   * 1. Создать новую копилку (только для ребенка)
   */
  async createPiggyBank(userId: string, dto: CreatePiggyBankDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    // Проверяем, что создатель — ребенок
    this.checkIsChild(user);

    const initialAmount = dto.initialAmount ? Number(dto.initialAmount) : 0;

    let initialCard: any = null;
    if (initialAmount > 0) {
      initialCard = await this.getOrCreateCard(userId, dto.cardId);
      if (initialCard.isBlocked) {
        throw new BadRequestException('Указанная карта заблокирована');
      }
      if (Number(initialCard.balance) < initialAmount) {
        throw new BadRequestException(
          `Недостаточно средств на карте для начального взноса в копилку. Требуется: ${initialAmount.toFixed(2)} BYN, доступно: ${Number(initialCard.balance).toFixed(2)} BYN`,
        );
      }
    }

    const createdPiggyBank = await this.prisma.$transaction(async (tx) => {
      // 1. Создаем копилку
      const piggy = await tx.piggyBank.create({
        data: {
          title: dto.title,
          description: dto.description || null,
          targetAmount: dto.targetAmount,
          currentAmount: initialAmount,
          targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
          status: PiggyBankStatus.ACTIVE,
          ownerId: userId,
        },
        include: {
          owner: true,
          contributions: {
            include: { user: true, card: true },
          },
        },
      });

      // 2. Если есть стартовый взнос — списываем с карты ребенка и пишем в историю
      if (initialAmount > 0 && initialCard) {
        await tx.card.update({
          where: { id: initialCard.id },
          data: { balance: { decrement: initialAmount } },
        });

        await tx.transaction.create({
          data: {
            userId,
            cardId: initialCard.id,
            amount: initialAmount,
            merchant: `Копилка: ${dto.title} (начальный взнос)`,
            category: 'SAVINGS',
            status: 'SUCCESS',
          },
        });

        const contribution = await tx.piggyBankContribution.create({
          data: {
            piggyBankId: piggy.id,
            userId,
            cardId: initialCard.id,
            amount: initialAmount,
            comment: 'Начальный взнос из карманных денег',
          },
          include: { user: true, card: true },
        });

        piggy.contributions = [contribution];
      }

      return piggy;
    });

    return {
      message: `Копилка "${createdPiggyBank.title}" успешно создана! Цель: ${Number(createdPiggyBank.targetAmount).toFixed(2)} BYN`,
      piggyBank: this.formatPiggyBank(createdPiggyBank),
    };
  }

  /**
   * 2. Пополнить копилку ребенка (сам ребенок со своих карманных денег или любой член семьи)
   */
  async topUpPiggyBank(senderUserId: string, piggyBankId: string, dto: TopUpPiggyBankDto) {
    const piggyBank = await this.prisma.piggyBank.findUnique({
      where: { id: piggyBankId },
      include: {
        owner: true,
      },
    });

    if (!piggyBank) {
      throw new NotFoundException('Копилка не найдена');
    }

    if (piggyBank.status !== PiggyBankStatus.ACTIVE) {
      throw new BadRequestException('Нельзя пополнять завершенную или закрытую копилку');
    }

    // Проверяем, что пополняющий — сам ребенок или член его семьи
    const isFamily = await this.verifyFamilyMember(senderUserId, piggyBank.ownerId);
    if (!isFamily) {
      throw new ForbiddenException(
        'Пополнять копилку могут только сам ребенок или члены его семьи (родители, братья, сестры)',
      );
    }

    // Находим карту пополнителя
    const senderCard = await this.getOrCreateCard(senderUserId, dto.cardId);

    if (senderCard.isBlocked) {
      throw new BadRequestException('Указанная карта заблокирована');
    }

    const currentBalance = Number(senderCard.balance);
    if (currentBalance < dto.amount) {
      throw new BadRequestException(
        `Недостаточно средств на карте для пополнения копилки. Требуется: ${dto.amount.toFixed(2)} BYN, доступно: ${currentBalance.toFixed(2)} BYN`,
      );
    }

    const [updatedCard, updatedPiggyBank] = await this.prisma.$transaction(async (tx) => {
      // 1. Списываем средства с карты отправителя
      const cardAfterDebit = await tx.card.update({
        where: { id: senderCard.id },
        data: { balance: { decrement: dto.amount } },
      });

      // 2. Создаем банковскую транзакцию
      await tx.transaction.create({
        data: {
          userId: senderUserId,
          cardId: senderCard.id,
          amount: dto.amount,
          merchant: `Пополнение копилки ребенка ${piggyBank.owner.name}: ${piggyBank.title}`,
          category: 'SAVINGS',
          status: 'SUCCESS',
        },
      });

      // 3. Записываем пополнение в копилку
      await tx.piggyBankContribution.create({
        data: {
          piggyBankId: piggyBank.id,
          userId: senderUserId,
          cardId: senderCard.id,
          amount: dto.amount,
          comment: dto.comment || null,
        },
      });

      // 4. Увеличиваем баланс копилки
      const newCurrentAmount = Number(piggyBank.currentAmount) + dto.amount;
      const isTargetReached = newCurrentAmount >= Number(piggyBank.targetAmount);

      const piggy = await tx.piggyBank.update({
        where: { id: piggyBankId },
        data: {
          currentAmount: { increment: dto.amount },
        },
        include: {
          owner: true,
          contributions: {
            include: { user: true, card: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      return [cardAfterDebit, piggy];
    });

    const currentTotal = Number(updatedPiggyBank.currentAmount);
    const targetTotal = Number(updatedPiggyBank.targetAmount);

    return {
      message: `Копилка "${updatedPiggyBank.title}" успешно пополнена на ${dto.amount.toFixed(2)} BYN! Накоплено: ${currentTotal.toFixed(2)} / ${targetTotal.toFixed(2)} BYN`,
      senderCardBalance: Number(updatedCard.balance),
      piggyBank: this.formatPiggyBank(updatedPiggyBank),
    };
  }

  /**
   * 3. Снять деньги из копилки / разбить копилку (только ребенок-владелец)
   */
  async withdrawPiggyBank(childUserId: string, piggyBankId: string, dto: WithdrawPiggyBankDto) {
    const piggyBank = await this.prisma.piggyBank.findUnique({
      where: { id: piggyBankId },
      include: {
        owner: true,
        contributions: {
          include: { user: true, card: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!piggyBank) {
      throw new NotFoundException('Копилка не найдена');
    }

    if (piggyBank.ownerId !== childUserId) {
      throw new ForbiddenException('Снимать средства из копилки может только ее владелец-ребенок');
    }

    const accumulatedAmount = Number(piggyBank.currentAmount);
    if (accumulatedAmount <= 0) {
      throw new BadRequestException('В копилке нет накопленных средств для снятия');
    }

    // Карта ребенка для зачисления средств
    const childCard = await this.getOrCreateCard(childUserId, dto.cardId);

    const isGoalReached = accumulatedAmount >= Number(piggyBank.targetAmount);
    const newStatus = dto.breakPiggyBank
      ? PiggyBankStatus.BROKEN
      : isGoalReached
      ? PiggyBankStatus.COMPLETED
      : PiggyBankStatus.BROKEN;

    const [updatedCard, updatedPiggy] = await this.prisma.$transaction(async (tx) => {
      // 1. Зачисляем деньги на карту ребенка
      const cardAfterCredit = await tx.card.update({
        where: { id: childCard.id },
        data: { balance: { increment: accumulatedAmount } },
      });

      // 2. Создаем транзакцию зачисления
      await tx.transaction.create({
        data: {
          userId: childUserId,
          cardId: childCard.id,
          amount: accumulatedAmount,
          merchant: `Выплата из копилки: ${piggyBank.title}`,
          category: 'SAVINGS',
          status: 'SUCCESS',
        },
      });

      // 3. Обнуляем копилку и выставляем статус
      const finished = await tx.piggyBank.update({
        where: { id: piggyBankId },
        data: {
          currentAmount: 0.0,
          status: newStatus,
        },
        include: {
          owner: true,
          contributions: {
            include: { user: true, card: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      return [cardAfterCredit, finished];
    });

    return {
      message: `Средства из копилки в размере ${accumulatedAmount.toFixed(2)} BYN успешно зачислены на карту ребенка!`,
      withdrawnAmount: accumulatedAmount,
      childCardBalance: Number(updatedCard.balance),
      piggyBank: this.formatPiggyBank(updatedPiggy),
    };
  }

  /**
   * 4. Получить список копилок:
   * - Для ребенка: его собственные копилки
   * - Для родителя: копилки всех детей его семьи
   */
  async getPiggyBanks(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        childRelations: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    const isChild =
      user.role === UserRole.CHILD_7_13 ||
      user.role === UserRole.TEEN_14_17 ||
      !isAdult(new Date(user.birthDay));

    let whereClause: any = {};

    if (isChild) {
      // Ребенок видит свои копилки
      whereClause = { ownerId: userId };
    } else {
      // Родитель видит копилки своих детей в семье
      const childIds = user.childRelations.map((rel) => rel.childId);
      whereClause = { ownerId: { in: childIds } };
    }

    const piggyBanks = await this.prisma.piggyBank.findMany({
      where: whereClause,
      include: {
        owner: true,
        contributions: {
          include: { user: true, card: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return piggyBanks.map((p) => this.formatPiggyBank(p));
  }

  /**
   * 5. Получить детальную информацию по конкретной копилке
   */
  async getPiggyBankById(userId: string, piggyBankId: string) {
    const piggyBank = await this.prisma.piggyBank.findUnique({
      where: { id: piggyBankId },
      include: {
        owner: true,
        contributions: {
          include: { user: true, card: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!piggyBank) {
      throw new NotFoundException('Копилка не найдена');
    }

    const isFamily = await this.verifyFamilyMember(userId, piggyBank.ownerId);
    if (!isFamily) {
      throw new ForbiddenException('У вас нет доступа к просмотру этой копилки');
    }

    return this.formatPiggyBank(piggyBank);
  }

  /**
   * 6. Редактировать копилку (название, описание, целевая сумма, дата)
   */
  async updatePiggyBank(childUserId: string, piggyBankId: string, dto: UpdatePiggyBankDto) {
    const piggyBank = await this.prisma.piggyBank.findUnique({
      where: { id: piggyBankId },
    });

    if (!piggyBank) {
      throw new NotFoundException('Копилка не найдена');
    }

    if (piggyBank.ownerId !== childUserId) {
      throw new ForbiddenException('Редактировать копилку может только ее владелец-ребенок');
    }

    if (piggyBank.status !== PiggyBankStatus.ACTIVE) {
      throw new BadRequestException('Нельзя редактировать завершенную или разбитую копилку');
    }

    const updated = await this.prisma.piggyBank.update({
      where: { id: piggyBankId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.targetAmount !== undefined && { targetAmount: dto.targetAmount }),
        ...(dto.targetDate !== undefined && {
          targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
        }),
      },
      include: {
        owner: true,
        contributions: {
          include: { user: true, card: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return this.formatPiggyBank(updated);
  }

  /**
   * 7. Удалить копилку (если в ней были накопления — они возвращаются на карту ребенка)
   */
  async deletePiggyBank(childUserId: string, piggyBankId: string) {
    const piggyBank = await this.prisma.piggyBank.findUnique({
      where: { id: piggyBankId },
    });

    if (!piggyBank) {
      throw new NotFoundException('Копилка не найдена');
    }

    if (piggyBank.ownerId !== childUserId) {
      throw new ForbiddenException('Удалить копилку может только ее владелец-ребенок');
    }

    const balanceToRefund = Number(piggyBank.currentAmount);

    await this.prisma.$transaction(async (tx) => {
      // Если в копилке оставались деньги — возвращаем на карту ребенка
      if (balanceToRefund > 0) {
        const card = await this.getOrCreateCard(childUserId);
        await tx.card.update({
          where: { id: card.id },
          data: { balance: { increment: balanceToRefund } },
        });

        await tx.transaction.create({
          data: {
            userId: childUserId,
            cardId: card.id,
            amount: balanceToRefund,
            merchant: `Возврат средств при удалении копилки: ${piggyBank.title}`,
            category: 'SAVINGS',
            status: 'SUCCESS',
          },
        });
      }

      await tx.piggyBank.delete({
        where: { id: piggyBankId },
      });
    });

    return {
      message:
        balanceToRefund > 0
          ? `Копилка "${piggyBank.title}" удалена. Накопленные средства (${balanceToRefund.toFixed(2)} BYN) возвращены на карту ребенка.`
          : `Копилка "${piggyBank.title}" успешно удалена.`,
      refundedAmount: balanceToRefund,
    };
  }
}
