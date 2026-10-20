import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  PayQrDto,
  CreateTransferRequestDto,
  ApproveTransferRequestDto,
  DeclineTransferRequestDto,
} from './payments.dto';
import { resolveMcc } from './payments.constants';
import { isAdult } from '../../common/isAdult.helper';
import {
  NotificationType,
  TransactionStatus,
  TransferRequestStatus,
  UserRole,
} from '#generated/prisma';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async payByQr(userId: string, dto: PayQrDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { cards: true },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    const card = dto.cardId
      ? user.cards.find((c) => c.id === dto.cardId)
      : user.cards[0];

    if (!card) {
      throw new NotFoundException('У пользователя нет выпущенных карт');
    }

    if (card.isBlocked) {
      throw new ForbiddenException({
        status: 'CARD_BLOCKED',
        message: 'Карта заблокирована родителем или банком',
      });
    }

    // 1. Нормализуем товары (поддерживаем как items: [...], так и одиночные mcc + amount)
    const items =
      dto.items && dto.items.length > 0
        ? dto.items
        : [
          {
            name: dto.merchant,
            mcc: dto.mcc!,
            amount: dto.amount!,
          },
        ];

    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

    // 2. ПРОВЕРКА 18+ ОГРАНИЧЕНИЙ ДЛЯ НЕСОВЕРШЕННОЛЕТНИХ
    const isMinor =
      user.role === UserRole.CHILD_7_13 || user.role === UserRole.TEEN_14_17 || !isAdult(user.birthDay);

    const restrictedItem = isMinor
      ? items.find((item) => resolveMcc(item.mcc).isRestricted18Plus)
      : undefined;

    if (restrictedItem) {
      const mccInfo = resolveMcc(restrictedItem.mcc);
      const declinedTx = await this.prisma.transaction.create({
        data: {
          amount: totalAmount,
          merchant: `${dto.merchant}${restrictedItem.name ? ` (${restrictedItem.name})` : ''}`,
          category: mccInfo.category,
          status: TransactionStatus.DECLINED_BY_BANK,
          userId: user.id,
          cardId: card.id,
        },
      });

      // Отправляем экстренное уведомление родителям (HTTP + Socket.IO)
      await this.notificationsService.notifyParents(user.id, {
        type: NotificationType.RESTRICTED_18_PURCHASE,
        title: '⚠️ Попытка покупки 18+ товара!',
        message: `Ребенок ${user.name} пытался оплатить товар категории «${mccInfo.label}» (18+) в магазине «${dto.merchant}» на сумму ${totalAmount.toFixed(2)} BYN. Покупка заблокирована банком.`,
        data: {
          childId: user.id,
          childName: user.name,
          merchant: dto.merchant,
          itemName: restrictedItem.name,
          mcc: restrictedItem.mcc,
          category: mccInfo.category,
          amount: totalAmount,
          transactionId: declinedTx.id,
          cardId: card.id,
          cardMask: card.cardNumberMask,
        },
      });

      throw new ForbiddenException({
        status: TransactionStatus.DECLINED_BY_BANK,
        message: `Защита МТБанка: в корзине найден товар категории «${mccInfo.label}» (18+), запрещенной для детских карт.`,
        transaction: declinedTx,
      });
    }

    // 3. ПРОВЕРКА ПОКУПКИ В НОЧНОЕ ВРЕМЯ (ПОСЛЕ 23:00 И ДО 06:00)
    const now = new Date();
    const minskHour = (now.getUTCHours() + 3) % 24; // Часовой пояс Минска (UTC+3)
    const isNightPurchase = minskHour >= 23 || minskHour < 6;

    if (isMinor && isNightPurchase) {
      const timeStr = now.toLocaleTimeString('ru-RU', {
        timeZone: 'Europe/Minsk',
        hour: '2-digit',
        minute: '2-digit',
      });

      // Отправляем уведомление родителям о ночной активности (HTTP + Socket.IO)
      await this.notificationsService.notifyParents(user.id, {
        type: NotificationType.NIGHT_PURCHASE,
        title: '🌙 Покупка в ночное время (после 23:00)',
        message: `Ребенок ${user.name} совершает покупку в магазине «${dto.merchant}» на сумму ${totalAmount.toFixed(2)} BYN в ночное время (${timeStr}).`,
        data: {
          childId: user.id,
          childName: user.name,
          merchant: dto.merchant,
          amount: totalAmount,
          cardId: card.id,
          cardMask: card.cardNumberMask,
          time: timeStr,
        },
      });
    }

    // 4. ПРОВЕРКА БАЛАНСА
    const currentBalance = Number(card.balance);
    if (currentBalance < totalAmount) {
      throw new BadRequestException({
        status: 'INSUFFICIENT_FUNDS',
        message: `Недостаточно средств на карте. К оплате: ${totalAmount.toFixed(2)} BYN, доступно: ${currentBalance.toFixed(2)} BYN`,
      });
    }

    // 5. ПРОВЕРКА РОДИТЕЛЬСКОГО ДНЕВНОГО ЛИМИТА
    const spentToday = Number(card.spentToday);
    const dailyLimit = Number(card.dailyLimit);

    if (isMinor && spentToday + totalAmount > dailyLimit) {
      // Создаем транзакции по товарам в статусе ожидания подтверждения
      const pendingTransactions = await this.prisma.$transaction(
        items.map((item) => {
          const mccInfo = resolveMcc(item.mcc);
          const merchantName = item.name
            ? `${dto.merchant} - ${item.name}`
            : dto.merchant;

          return this.prisma.transaction.create({
            data: {
              amount: item.amount,
              merchant: merchantName,
              category: mccInfo.category,
              status: TransactionStatus.PENDING_PARENT_APPROVAL,
              userId: user.id,
              cardId: card.id,
            },
          });
        }),
      );

      // Уведомляем родителей о превышении лимита (HTTP + Socket.IO)
      await this.notificationsService.notifyParents(user.id, {
        type: NotificationType.LIMIT_EXCEEDED,
        title: '🛑 Превышение дневного лимита по карте',
        message: `Ребенок ${user.name} пытается совершить покупку в «${dto.merchant}» на ${totalAmount.toFixed(2)} BYN, что превышает дневной лимит (${dailyLimit} BYN). Запрос ожидает подтверждения.`,
        data: {
          childId: user.id,
          childName: user.name,
          merchant: dto.merchant,
          amount: totalAmount,
          dailyLimit,
          spentToday,
        },
      });

      return {
        status: TransactionStatus.PENDING_PARENT_APPROVAL,
        message: `Превышен дневной лимит (${dailyLimit} BYN). Запрос на подтверждение отправлен родителю!`,
        totalAmount,
        remainingLimit: Math.max(0, dailyLimit - spentToday),
        transactions: pendingTransactions,
      };
    }

    // 5. УСПЕШНОЕ СПИСАНИЕ (Атомарная транзакция в БД)
    const txOperations = [
      this.prisma.card.update({
        where: { id: card.id },
        data: {
          balance: { decrement: totalAmount },
          spentToday: { increment: totalAmount },
        },
      }),
      ...items.map((item) => {
        const mccInfo = resolveMcc(item.mcc);
        const merchantName = item.name
          ? `${dto.merchant} - ${item.name}`
          : dto.merchant;

        return this.prisma.transaction.create({
          data: {
            amount: item.amount,
            merchant: merchantName,
            category: mccInfo.category,
            status: TransactionStatus.SUCCESS,
            userId: user.id,
            cardId: card.id,
          },
        });
      }),
    ];

    const [updatedCard, ...createdTransactions] = await this.prisma.$transaction(txOperations as any);

    return {
      status: TransactionStatus.SUCCESS,
      message: 'Оплата прошла успешно!',
      totalAmount,
      newBalance: Number(updatedCard.balance),
      spentToday: Number(updatedCard.spentToday),
      dailyLimit: Number(updatedCard.dailyLimit),
      transactions: createdTransactions,
    };
  }

  /**
   * 1. Создать запрос на перевод денег у родителей
   */
  async createTransferRequest(childId: string, dto: CreateTransferRequestDto) {
    const child = await this.prisma.user.findUnique({
      where: { id: childId },
      include: {
        cards: true,
        parentRelations: true,
      },
    });

    if (!child) {
      throw new NotFoundException('Пользователь не найден');
    }

    if (child.role !== UserRole.CHILD_7_13 && child.role !== UserRole.TEEN_14_17) {
      throw new BadRequestException('Запрашивать перевод у родителей могут только дети');
    }

    if (child.parentRelations.length === 0) {
      throw new BadRequestException('У вас нет привязанных родителей для запроса перевода');
    }

    const targetCard = child.cards.find((c) => c.id === dto.cardId);
    if (!targetCard) {
      throw new NotFoundException('Указанная карта не найдена или не принадлежит вам');
    }

    if (targetCard.isBlocked) {
      throw new BadRequestException('Нельзя запросить перевод на заблокированную карту');
    }

    const transferRequest = await this.prisma.transferRequest.create({
      data: {
        childId,
        cardId: targetCard.id,
        amount: dto.amount,
        comment: dto.comment,
        status: TransferRequestStatus.PENDING,
      },
      include: {
        card: {
          select: {
            id: true,
            cardNumberMask: true,
            cardholderName: true,
            type: true,
          },
        },
      },
    });

    return {
      message: 'Запрос на перевод денег успешно отправлен родителям',
      transferRequest: {
        id: transferRequest.id,
        amount: Number(transferRequest.amount),
        comment: transferRequest.comment,
        status: transferRequest.status,
        createdAt: transferRequest.createdAt,
        card: transferRequest.card,
      },
    };
  }

  /**
   * 2. Получить список запросов на перевод
   * (Ребенок видит свои запросы, родитель — запросы всех своих детей)
   */
  async getTransferRequests(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        childRelations: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    // Если родитель: ищем запросы всех его привязанных детей
    if (user.role === UserRole.PARENT) {
      const childIds = user.childRelations.map((rel) => rel.childId);

      const requests = await this.prisma.transferRequest.findMany({
        where: {
          childId: { in: childIds },
        },
        include: {
          child: {
            select: {
              id: true,
              name: true,
              phoneNumber: true,
            },
          },
          card: {
            select: {
              id: true,
              cardNumberMask: true,
              balance: true,
            },
          },
          resolvedBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return requests.map((req) => ({
        id: req.id,
        amount: Number(req.amount),
        comment: req.comment,
        status: req.status,
        declineReason: req.declineReason,
        createdAt: req.createdAt,
        updatedAt: req.updatedAt,
        child: req.child,
        card: {
          ...req.card,
          balance: Number(req.card.balance),
        },
        resolvedBy: req.resolvedBy,
      }));
    }

    // Если ребенок: возвращаем его собственные запросы
    const requests = await this.prisma.transferRequest.findMany({
      where: { childId: userId },
      include: {
        card: {
          select: {
            id: true,
            cardNumberMask: true,
            balance: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((req) => ({
      id: req.id,
      amount: Number(req.amount),
      comment: req.comment,
      status: req.status,
      declineReason: req.declineReason,
      createdAt: req.createdAt,
      updatedAt: req.updatedAt,
      card: {
        ...req.card,
        balance: Number(req.card.balance),
      },
      resolvedBy: req.resolvedBy,
    }));
  }

  /**
   * 3. Одобрить запрос на перевод (для родителя)
   */
  async approveTransferRequest(parentId: string, requestId: string, dto?: ApproveTransferRequestDto) {
    const parent = await this.prisma.user.findUnique({
      where: { id: parentId },
      include: { cards: true },
    });

    if (!parent) {
      throw new NotFoundException('Родитель не найден');
    }

    const request = await this.prisma.transferRequest.findUnique({
      where: { id: requestId },
      include: {
        child: true,
        card: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Запрос на перевод не найден');
    }

    if (request.status !== TransferRequestStatus.PENDING) {
      throw new BadRequestException(`Запрос уже обработан со статусом: ${request.status}`);
    }

    // Проверяем, что подтверждающий пользователь действительно родитель этого ребенка
    const relation = await this.prisma.familyRelation.findUnique({
      where: {
        parentId_childId: {
          parentId,
          childId: request.childId,
        },
      },
    });

    if (!relation) {
      throw new ForbiddenException('Вы не являетесь родителем этого ребенка');
    }

    // Выбираем карту родителя для списания
    let parentCard = dto?.parentCardId
      ? parent.cards.find((c) => c.id === dto.parentCardId)
      : parent.cards.find((c) => Number(c.balance) >= Number(request.amount) && !c.isBlocked);

    if (!parentCard && !dto?.parentCardId) {
      parentCard = parent.cards.find((c) => !c.isBlocked);
    }

    if (!parentCard) {
      throw new BadRequestException('У родителя нет доступных карт для перевода');
    }

    if (parentCard.isBlocked) {
      throw new BadRequestException('Выбранная карта родителя заблокирована');
    }

    if (Number(parentCard.balance) < Number(request.amount)) {
      throw new BadRequestException(
        `Недостаточно средств на карте родителя (баланс: ${Number(parentCard.balance)} BYN, требуется: ${Number(request.amount)} BYN)`,
      );
    }

    const transferAmount = Number(request.amount);

    // Выполняем атомарный перевод и обновляем статус запроса
    const [updatedParentCard, updatedChildCard, updatedRequest] = await this.prisma.$transaction([
      // 1. Списание с карты родителя
      this.prisma.card.update({
        where: { id: parentCard.id },
        data: {
          balance: { decrement: transferAmount },
        },
      }),
      // 2. Пополнение карты ребенка
      this.prisma.card.update({
        where: { id: request.cardId },
        data: {
          balance: { increment: transferAmount },
        },
      }),
      // 3. Обновление статуса запроса на APPROVED
      this.prisma.transferRequest.update({
        where: { id: request.id },
        data: {
          status: TransferRequestStatus.APPROVED,
          resolvedById: parent.id,
        },
        include: {
          child: { select: { id: true, name: true } },
          card: { select: { id: true, cardNumberMask: true, balance: true } },
          resolvedBy: { select: { id: true, name: true } },
        },
      }),
      // 4. Транзакция списания родителю
      this.prisma.transaction.create({
        data: {
          amount: transferAmount,
          merchant: `Перевод ребенку: ${request.child.name}`,
          category: 'TRANSFER',
          status: TransactionStatus.SUCCESS,
          userId: parent.id,
          cardId: parentCard.id,
        },
      }),
      // 5. Транзакция пополнения ребенку
      this.prisma.transaction.create({
        data: {
          amount: transferAmount,
          merchant: `Пополнение от родителя: ${parent.name}`,
          category: 'TRANSFER',
          status: TransactionStatus.SUCCESS,
          userId: request.childId,
          cardId: request.cardId,
        },
      }),
    ]);

    return {
      message: 'Перевод успешно отправлен ребенку',
      transferRequest: {
        id: updatedRequest.id,
        amount: Number(updatedRequest.amount),
        comment: updatedRequest.comment,
        status: updatedRequest.status,
        child: updatedRequest.child,
        card: {
          ...updatedRequest.card,
          balance: Number(updatedChildCard.balance),
        },
        parentCardBalance: Number(updatedParentCard.balance),
        resolvedBy: updatedRequest.resolvedBy,
      },
    };
  }

  /**
   * 4. Отклонить запрос на перевод (для родителя)
   */
  async declineTransferRequest(parentId: string, requestId: string, dto?: DeclineTransferRequestDto) {
    const parent = await this.prisma.user.findUnique({
      where: { id: parentId },
    });

    if (!parent) {
      throw new NotFoundException('Родитель не найден');
    }

    const request = await this.prisma.transferRequest.findUnique({
      where: { id: requestId },
      include: { child: true },
    });

    if (!request) {
      throw new NotFoundException('Запрос на перевод не найден');
    }

    if (request.status !== TransferRequestStatus.PENDING) {
      throw new BadRequestException(`Запрос уже обработан со статусом: ${request.status}`);
    }

    const relation = await this.prisma.familyRelation.findUnique({
      where: {
        parentId_childId: {
          parentId,
          childId: request.childId,
        },
      },
    });

    if (!relation) {
      throw new ForbiddenException('Вы не являетесь родителем этого ребенка');
    }

    const updated = await this.prisma.transferRequest.update({
      where: { id: request.id },
      data: {
        status: TransferRequestStatus.DECLINED,
        declineReason: dto?.reason || 'Отклонено родителем',
        resolvedById: parent.id,
      },
      include: {
        child: { select: { id: true, name: true } },
        card: { select: { id: true, cardNumberMask: true } },
        resolvedBy: { select: { id: true, name: true } },
      },
    });

    return {
      message: 'Запрос на перевод отклонен',
      transferRequest: {
        id: updated.id,
        amount: Number(updated.amount),
        comment: updated.comment,
        status: updated.status,
        declineReason: updated.declineReason,
        child: updated.child,
        card: updated.card,
        resolvedBy: updated.resolvedBy,
      },
    };
  }
}

