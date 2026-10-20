import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { PayQrDto } from './payments.dto';
import { resolveMcc } from './payments.constants';
import { TransactionStatus, UserRole } from 'generated/prisma/enums';
import { isAdult } from '../../common/isAdult.helper';
@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

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

    const mccInfo = resolveMcc(dto.mcc);
    const isMinor =
      user.role === UserRole.CHILD_7_13 || user.role === UserRole.TEEN_14_17;

    if (isMinor && isAdult(user.birthDay) && mccInfo.isRestricted18Plus) {
      const declinedTx = await this.prisma.transaction.create({
        data: {
          amount: dto.amount,
          merchant: dto.merchant,
          category: mccInfo.category,
          status: TransactionStatus.DECLINED_BY_BANK,
          userId: user.id,
          cardId: card.id,
        },
      });

      throw new ForbiddenException({
        status: TransactionStatus.DECLINED_BY_BANK,
        message: `Защита МТБанка: операции в категории «${mccInfo.label}» (18+) запрещены для детских карт.`,
        transaction: declinedTx,
      });
    }

    // 3. ПРОВЕРКА БАЛАНСА
    const currentBalance = Number(card.balance);
    if (currentBalance < dto.amount) {
      throw new BadRequestException({
        status: 'INSUFFICIENT_FUNDS',
        message: `Недостаточно средств на карте. Доступно: ${currentBalance.toFixed(2)} BYN`,
      });
    }

    // 4. ПРОВЕРКА РОДИТЕЛЬСКОГО ДНЕВНОГО ЛИМИТА
    const spentToday = Number(card.spentToday);
    const dailyLimit = Number(card.dailyLimit);

    if (isMinor && spentToday + dto.amount > dailyLimit) {
      // Записываем транзакцию в статус ожидания подтверждения от родителя
      const pendingTx = await this.prisma.transaction.create({
        data: {
          amount: dto.amount,
          merchant: dto.merchant,
          category: mccInfo.category,
          status: TransactionStatus.PENDING_PARENT_APPROVAL,
          userId: user.id,
          cardId: card.id,
        },
      });

      return {
        status: TransactionStatus.PENDING_PARENT_APPROVAL,
        message: `Превышен дневной лимит (${dailyLimit} BYN). Запрос на подтверждение отправлен родителю!`,
        remainingLimit: Math.max(0, dailyLimit - spentToday),
        transaction: pendingTx,
      };
    }

    // 5. УСПЕШНОЕ СПИСАНИЕ (Атомарная транзакция в БД)
    const [updatedCard, transaction] = await this.prisma.$transaction([
      this.prisma.card.update({
        where: { id: card.id },
        data: {
          balance: { decrement: dto.amount },
          spentToday: { increment: dto.amount },
        },
      }),
      this.prisma.transaction.create({
        data: {
          amount: dto.amount,
          merchant: dto.merchant,
          category: mccInfo.category,
          status: TransactionStatus.SUCCESS,
          userId: user.id,
          cardId: card.id,
        },
      }),
    ]);

    return {
      status: TransactionStatus.SUCCESS,
      message: 'Оплата прошла успешно!',
      newBalance: Number(updatedCard.balance),
      spentToday: Number(updatedCard.spentToday),
      dailyLimit: Number(updatedCard.dailyLimit),
      transaction,
    };
  }
}
