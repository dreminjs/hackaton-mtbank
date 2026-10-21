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
  ParentToChildTransferDto,
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
import { NotificationsGateway } from '../notifications/notifications.gateway';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
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

  /**
   * 5. Прямой перевод денег ребенку от родителя
   * Родитель выбирает ребенка, сумму, комментарий и переводит средства напрямую.
   */
  async transferToChild(parentId: string, dto: ParentToChildTransferDto) {
    // 1. Проверяем родителя
    const parent = await this.prisma.user.findUnique({
      where: { id: parentId },
      include: { cards: true },
    });

    if (!parent) {
      throw new NotFoundException('Родитель не найден');
    }

    // 2. Проверяем ребенка
    const child = await this.prisma.user.findUnique({
      where: { id: dto.childId },
      include: { cards: true },
    });

    if (!child) {
      throw new NotFoundException('Ребенок с указанным ID не найден');
    }

    // 3. Проверяем семейную связь: родитель -> ребенок
    const relation = await this.prisma.familyRelation.findUnique({
      where: {
        parentId_childId: {
          parentId,
          childId: dto.childId,
        },
      },
    });

    if (!relation) {
      throw new ForbiddenException('Пользователь не является вашим ребенком в семейном профиле');
    }

    // 4. Выбираем карту родителя для списания
    let parentCard = dto.parentCardId
      ? parent.cards.find((c) => c.id === dto.parentCardId)
      : parent.cards.find((c) => Number(c.balance) >= dto.amount && !c.isBlocked);

    if (!parentCard && !dto.parentCardId) {
      parentCard = parent.cards.find((c) => !c.isBlocked);
    }

    if (!parentCard) {
      throw new BadRequestException('У родителя нет доступных карт для перевода');
    }

    if (parentCard.isBlocked) {
      throw new BadRequestException('Выбранная карта родителя заблокирована');
    }

    if (Number(parentCard.balance) < dto.amount) {
      throw new BadRequestException(
        `Недостаточно средств на карте родителя (баланс: ${Number(parentCard.balance)} BYN, требуется: ${dto.amount} BYN)`,
      );
    }

    // 5. Выбираем или создаем карту ребенка для зачисления
    let childCard = dto.childCardId
      ? child.cards.find((c) => c.id === dto.childCardId)
      : child.cards.find((c) => !c.isBlocked);

    if (!childCard) {
      if (child.cards.length > 0) {
        childCard = child.cards[0];
      } else {
        // Автоматически выпускаем виртуальную карту ребенку, если у него еще нет карт
        const randomLastDigits = Math.floor(1000 + Math.random() * 9000).toString();
        childCard = await this.prisma.card.create({
          data: {
            userId: child.id,
            cardNumberMask: `4258 •••• •••• ${randomLastDigits}`,
            cardholderName: child.name.toUpperCase(),
            expiryDate: '10/29',
            type: 'VIRTUAL',
            balance: 0.0,
            dailyLimit: 50.0,
            spentToday: 0.0,
            allowOnlinePurchases: true,
            allowCashWithdrawal: true,
          },
        });
      }
    }

    if (childCard.isBlocked) {
      throw new BadRequestException('Карта ребенка заблокирована. Разблокируйте карту перед переводом');
    }

    const commentText = dto.comment?.trim() || 'Перевод от родителя';

    // 6. Атомарно выполняем перевод
    const [updatedParentCard, updatedChildCard, parentTx, childTx, transferRequest] =
      await this.prisma.$transaction([
        // Списание с родителя
        this.prisma.card.update({
          where: { id: parentCard.id },
          data: {
            balance: { decrement: dto.amount },
          },
        }),
        // Пополнение ребенку
        this.prisma.card.update({
          where: { id: childCard.id },
          data: {
            balance: { increment: dto.amount },
          },
        }),
        // Транзакция списания родителю
        this.prisma.transaction.create({
          data: {
            amount: dto.amount,
            merchant: `Перевод ребенку: ${child.name}${dto.comment ? ` (${dto.comment})` : ''}`,
            category: 'TRANSFER',
            status: TransactionStatus.SUCCESS,
            userId: parent.id,
            cardId: parentCard.id,
          },
        }),
        // Транзакция пополнения ребенку
        this.prisma.transaction.create({
          data: {
            amount: dto.amount,
            merchant: `Пополнение от родителя: ${parent.name}${dto.comment ? ` (${dto.comment})` : ''}`,
            category: 'TRANSFER',
            status: TransactionStatus.SUCCESS,
            userId: child.id,
            cardId: childCard.id,
          },
        }),
        // Фиксация в TransferRequest со статусом APPROVED
        this.prisma.transferRequest.create({
          data: {
            amount: dto.amount,
            comment: commentText,
            status: TransferRequestStatus.APPROVED,
            childId: child.id,
            cardId: childCard.id,
            resolvedById: parent.id,
          },
        }),
      ]);

    // 7. Мгновенное push-уведомление через Socket.IO ребенку
    try {
      const socketPayload = {
        type: 'PARENT_TRANSFER',
        title: '💸 Пополнение карты!',
        message: `Родитель ${parent.name} перевел вам ${dto.amount.toFixed(2)} BYN${dto.comment ? ` («${dto.comment}»)` : ''}`,
        amount: dto.amount,
        comment: dto.comment,
        parentName: parent.name,
        childCardBalance: Number(updatedChildCard.balance),
        cardMask: childCard.cardNumberMask,
        transactionId: childTx.id,
        createdAt: new Date().toISOString(),
      };

      this.notificationsGateway.sendToUser(child.id, 'parent_transfer', socketPayload);
      this.notificationsGateway.sendToUser(child.id, 'notification', socketPayload);
    } catch (e) {
      // Игнорируем сетевые ошибки сокетов
    }

    // 8. Сохраняем уведомление в БД для истории
    try {
      await this.prisma.notification.create({
        data: {
          type: NotificationType.TRANSFER_REQUEST,
          title: '💸 Пополнение карты от родителя',
          message: `Родитель ${parent.name} перевел ${dto.amount.toFixed(2)} BYN${dto.comment ? ` («${dto.comment}»)` : ''}`,
          data: {
            amount: dto.amount,
            comment: dto.comment,
            parentId: parent.id,
            parentName: parent.name,
            cardMask: childCard.cardNumberMask,
            transactionId: childTx.id,
          },
          userId: child.id,
          childId: child.id,
        },
      });
    } catch (e) {
      // Игнорируем ошибку сохранения уведомления
    }

    return {
      message: `Перевод на сумму ${dto.amount.toFixed(2)} BYN ребенку ${child.name} успешно выполнен!`,
      amount: dto.amount,
      comment: dto.comment,
      parentCard: {
        id: updatedParentCard.id,
        cardNumberMask: updatedParentCard.cardNumberMask,
        cardholderName: updatedParentCard.cardholderName,
        type: updatedParentCard.type,
        balance: Number(updatedParentCard.balance),
      },
      childCard: {
        id: updatedChildCard.id,
        cardNumberMask: updatedChildCard.cardNumberMask,
        cardholderName: updatedChildCard.cardholderName,
        type: updatedChildCard.type,
        balance: Number(updatedChildCard.balance),
      },
      child: {
        id: child.id,
        name: child.name,
      },
      transactions: {
        parentTransactionId: parentTx.id,
        childTransactionId: childTx.id,
      },
      transferRequestId: transferRequest.id,
    };
  }

  /**
   * Проверка родственной связи между пользователем и членом семьи
   * (поддерживает ребенка, родителя, второго родителя / супруга и братьев/сестер)
   */
  async verifyFamilyMember(userId: string, targetMemberId: string): Promise<boolean> {
    if (userId === targetMemberId) {
      return true;
    }

    // 1. Прямая связь: родитель -> ребенок
    const asParent = await this.prisma.familyRelation.findUnique({
      where: {
        parentId_childId: {
          parentId: userId,
          childId: targetMemberId,
        },
      },
    });
    if (asParent) return true;

    // 2. Прямая связь: ребенок -> родитель
    const asChild = await this.prisma.familyRelation.findUnique({
      where: {
        parentId_childId: {
          parentId: targetMemberId,
          childId: userId,
        },
      },
    });
    if (asChild) return true;

    // 3. Другой родитель (со-родитель общего ребенка в семье)
    const myChildren = await this.prisma.familyRelation.findMany({
      where: { parentId: userId },
      select: { childId: true },
    });
    if (myChildren.length > 0) {
      const coParent = await this.prisma.familyRelation.findFirst({
        where: {
          parentId: targetMemberId,
          childId: { in: myChildren.map((c) => c.childId) },
        },
      });
      if (coParent) return true;
    }

    // 4. Братья и сестры (дети общих родителей)
    const myParents = await this.prisma.familyRelation.findMany({
      where: { childId: userId },
      select: { parentId: true },
    });
    if (myParents.length > 0) {
      const sibling = await this.prisma.familyRelation.findFirst({
        where: {
          childId: targetMemberId,
          parentId: { in: myParents.map((p) => p.parentId) },
        },
      });
      if (sibling) return true;
    }

    return false;
  }

  /**
   * Преобразование транзакции для UI
   */
  private formatTransaction(t: any) {
    return {
      id: t.id,
      amount: Number(t.amount),
      merchant: t.merchant,
      category: t.category,
      status: t.status,
      user: {
        id: t.user.id,
        name: t.user.name,
        phoneNumber: t.user.phoneNumber,
        role: t.user.role,
      },
      card: {
        id: t.card.id,
        cardNumberMask: t.card.cardNumberMask,
        type: t.card.type,
      },
      createdAt: t.createdAt,
    };
  }

  /**
   * Получить историю транзакций конкретного члена семьи (ребенка или другого родителя)
   */
  async getMemberTransactions(
    currentUserId: string,
    memberId: string,
    filters?: {
      limit?: number;
      offset?: number;
      cardId?: string;
      category?: string;
    },
  ) {
    const isFamily = await this.verifyFamilyMember(currentUserId, memberId);
    if (!isFamily) {
      throw new ForbiddenException(
        'Указанный пользователь не является членом вашей семьи',
      );
    }

    const member = await this.prisma.user.findUnique({
      where: { id: memberId },
      select: { id: true, name: true, phoneNumber: true, role: true },
    });

    if (!member) {
      throw new NotFoundException('Член семьи не найден');
    }

    const whereClause: any = {
      userId: memberId,
      ...(filters?.cardId && { cardId: filters.cardId }),
      ...(filters?.category && { category: filters.category }),
    };

    const take = filters?.limit ? Math.min(Number(filters.limit), 100) : 50;
    const skip = filters?.offset ? Number(filters.offset) : 0;

    const [transactions, totalCount] = await Promise.all([
      this.prisma.transaction.findMany({
        where: whereClause,
        include: {
          user: {
            select: { id: true, name: true, phoneNumber: true, role: true },
          },
          card: {
            select: { id: true, cardNumberMask: true, type: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.transaction.count({ where: whereClause }),
    ]);

    // Считаем общую сумму расходов по успешным транзакциям
    const totalSpent = transactions
      .filter((t) => t.status === TransactionStatus.SUCCESS)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    return {
      member,
      totalSpent: Number(totalSpent.toFixed(2)),
      transactionCount: totalCount,
      transactions: transactions.map((t) => this.formatTransaction(t)),
    };
  }

  /**
   * Получить общую ленту расходов всей семьи (все дети и родители)
   */
  async getFamilyTransactions(
    currentUserId: string,
    filters?: {
      limit?: number;
      offset?: number;
      category?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: currentUserId },
      include: {
        childRelations: true,
        parentRelations: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    let allMemberIds: string[] = [currentUserId];

    const isChild =
      user.role === UserRole.CHILD_7_13 ||
      user.role === UserRole.TEEN_14_17 ||
      !isAdult(new Date(user.birthDay));

    if (!isChild) {
      // Для родителя: его дети + другие родители этих детей
      const childIds = user.childRelations.map((rel) => rel.childId);
      const otherParents = await this.prisma.familyRelation.findMany({
        where: { childId: { in: childIds } },
        select: { parentId: true },
      });
      allMemberIds = Array.from(
        new Set([currentUserId, ...childIds, ...otherParents.map((p) => p.parentId)]),
      );
    } else {
      // Для ребенка: его родители + его братья/сестры
      const parentIds = user.parentRelations.map((rel) => rel.parentId);
      const siblings = await this.prisma.familyRelation.findMany({
        where: { parentId: { in: parentIds } },
        select: { childId: true },
      });
      allMemberIds = Array.from(
        new Set([currentUserId, ...parentIds, ...siblings.map((s) => s.childId)]),
      );
    }

    const whereClause: any = {
      userId: { in: allMemberIds },
      ...(filters?.category && { category: filters.category }),
    };

    const take = filters?.limit ? Math.min(Number(filters.limit), 100) : 50;
    const skip = filters?.offset ? Number(filters.offset) : 0;

    const [transactions, totalCount] = await Promise.all([
      this.prisma.transaction.findMany({
        where: whereClause,
        include: {
          user: {
            select: { id: true, name: true, phoneNumber: true, role: true },
          },
          card: {
            select: { id: true, cardNumberMask: true, type: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.transaction.count({ where: whereClause }),
    ]);

    const familyTotalSpent = transactions
      .filter((t) => t.status === TransactionStatus.SUCCESS)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    return {
      familyTotalSpent: Number(familyTotalSpent.toFixed(2)),
      totalCount,
      transactions: transactions.map((t) => this.formatTransaction(t)),
    };
  }

  /**
   * Получить собственные транзакции текущего пользователя
   */
  async getMyTransactions(
    currentUserId: string,
    filters?: {
      limit?: number;
      offset?: number;
      cardId?: string;
      category?: string;
    },
  ) {
    return this.getMemberTransactions(currentUserId, currentUserId, filters);
  }
}


