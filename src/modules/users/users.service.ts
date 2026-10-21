import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AddChildDto, LinkChildDto, UpdateCardLimitsDto } from './users.dto';
import { resolveChildRole } from '../../common/isAdult.helper';

import { PassportService } from '../passport/passport.service';
import {
  PiggyBankStatus,
  TaskStatus,
  TransactionStatus,
  UserRole,
} from '#generated/prisma';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passportService: PassportService,
  ) { }

  /**
   * Сравнение имени из базы данных и имени/фамилии из паспорта
   */
  private matchNames(dbName: string, passportData: { firstName?: string; lastName?: string }): boolean {
    if (!dbName) return false;

    // Очищаем и разбиваем имя из БД на токены (например "Иван Иванов" или "Ivan Ivanov")
    const cleanTokens = (str: string) =>
      str
        .toUpperCase()
        .replace(/[^A-ZА-ЯЁ]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 2);

    const dbTokens = cleanTokens(dbName);
    const passFirstName = (passportData.firstName || '').toUpperCase().trim();
    const passLastName = (passportData.lastName || '').toUpperCase().trim();

    // Если OCR вообще ничего не нашел в имени и фамилии
    if (!passFirstName && !passLastName) {
      return false;
    }

    // Проверяем прямое вхождение или транслит/частичное совпадение
    const matchesToken = (token: string, target: string) => {
      if (!target || !token) return false;
      return token.includes(target) || target.includes(token);
    };

    const hasMatch = dbTokens.some((token) => {
      return (
        matchesToken(token, passFirstName) ||
        matchesToken(token, passLastName)
      );
    });

    return hasMatch;
  }

  /**
   * Добавить нового ребенка (создать аккаунт ребенка, привязать к родителю, выпустить виртуальную карту)
   */
  async addChild(parentId: string, dto: AddChildDto) {
    const parent = await this.prisma.user.findUnique({
      where: { id: parentId },
    });
    if (!parent) {
      throw new NotFoundException('Родитель не найден');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { phoneNumber: dto.phoneNumber },
    });
    if (existingUser) {
      throw new ConflictException(
        'Пользователь с таким номером телефона уже существует',
      );
    }

    const birthDate = new Date(dto.birthDay);
    const childRole = resolveChildRole(birthDate);

    if (childRole === UserRole.ORDINARY) {
      throw new BadRequestException(
        'Ребенок должен быть в возрасте от 7 до 17 лет',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    // Генерируем 4 последние цифры карты
    const randomLastDigits = Math.floor(1000 + Math.random() * 9000).toString();

    // Создаем ребенка, отношение с родителем, обновляем роль родителя на PARENT и создаем карту в транзакции
    const [child, updatedParent] = await this.prisma.$transaction(async (tx) => {
      // 1. Создаем ребенка
      const createdChild = await tx.user.create({
        data: {
          name: dto.name,
          phoneNumber: dto.phoneNumber,
          password: passwordHash,
          birthDay: birthDate,
          role: childRole,
          cards: {
            create: {
              cardNumberMask: `4258 •••• •••• ${randomLastDigits}`,
              cardholderName: dto.name.toUpperCase(),
              expiryDate: '10/29',
              type: 'VIRTUAL',
              balance: dto.initialBalance ?? 0,
              dailyLimit: dto.dailyLimit ?? 15.0,
              spentToday: 0,
              allowOnlinePurchases: true,
              allowCashWithdrawal: false,
            },
          },
        },
        include: {
          cards: true,
        },
      });

      // 2. Создаем связь с родителем
      await tx.familyRelation.create({
        data: {
          parentId: parent.id,
          childId: createdChild.id,
        },
      });

      // 3. Если у родителя еще не было роли PARENT, переводим его в PARENT
      const parentUser = await tx.user.update({
        where: { id: parent.id },
        data: {
          role: UserRole.PARENT,
        },
      });

      return [createdChild, parentUser];
    });

    return {
      message: 'Ребенок успешно зарегистрирован и привязан к семье',
      parentRole: updatedParent.role,
      child: {
        id: child.id,
        name: child.name,
        phoneNumber: child.phoneNumber,
        birthDay: child.birthDay,
        role: child.role,
        cards: child.cards,
      },
    };
  }

  /**
   * Привязать уже существующего пользователя как ребенка (с проверкой паспорта)
   */
  async linkChild(parentId: string, dto: LinkChildDto, passportFile?: Express.Multer.File) {
    const parent = await this.prisma.user.findUnique({
      where: { id: parentId },
    });
    if (!parent) {
      throw new NotFoundException('Родитель не найден');
    }

    const child = await this.prisma.user.findUnique({
      where: { phoneNumber: dto.phoneNumber },
    });
    if (!child) {
      throw new NotFoundException('Пользователь с таким номером телефона не найден');
    }

    if (child.id === parent.id) {
      throw new BadRequestException('Нельзя привязать самого себя в качестве ребенка');
    }

    // Проверяем, не привязан ли уже этот ребенок к текущему родителю
    const existingRelation = await this.prisma.familyRelation.findUnique({
      where: {
        parentId_childId: {
          parentId: parent.id,
          childId: child.id,
        },
      },
    });
    if (existingRelation) {
      throw new BadRequestException('Этот ребенок уже привязан к вашему аккаунту');
    }

    const childRole = resolveChildRole(new Date(child.birthDay));
    if (childRole === UserRole.ORDINARY) {
      throw new BadRequestException(
        'Привязываемый пользователь должен быть в возрасте от 7 до 17 лет',
      );
    }

    // Если передан скан паспорта — сверяем данные через PassportService
    let passportVerification: any = null;
    if (passportFile) {
      const passportData = await this.passportService.recognize(passportFile);
      if (!passportData) {
        throw new BadRequestException('Не удалось распознать данные из файла паспорта');
      }

      const isNameMatched = this.matchNames(child.name, passportData);
      if (!isNameMatched) {
        throw new BadRequestException({
          status: 'PASSPORT_NAME_MISMATCH',
          message: `Имя в паспорте (${passportData.lastName || ''} ${passportData.firstName || ''}) не совпадает с именем пользователя (${child.name})`,
          passportData,
        });
      }

      passportVerification = passportData;
    }

    const [, updatedChild, updatedParent] = await this.prisma.$transaction([
      this.prisma.familyRelation.create({
        data: {
          parentId: parent.id,
          childId: child.id,
        },
      }),
      this.prisma.user.update({
        where: { id: child.id },
        data: {
          role: childRole,
        },
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          birthDay: true,
          role: true,
        },
      }),
      this.prisma.user.update({
        where: { id: parent.id },
        data: {
          role: UserRole.PARENT,
        },
      }),
    ]);

    return {
      message: 'Член семьи успешно привязан',
      parentRole: updatedParent.role,
      child: updatedChild,
      passportVerification,
    };
  }

  /**
   * Получить состав семьи текущего пользователя (родителей и детей)
   */
  async getFamily(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        parentRelations: {
          include: {
            parent: {
              select: {
                id: true,
                name: true,
                phoneNumber: true,
                role: true,
              },
            },
          },
        },
        childRelations: {
          include: {
            child: {
              include: {
                cards: true,
              },
            },
          },
        },
        cards: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        phoneNumber: user.phoneNumber,
        birthDay: user.birthDay,
        role: user.role,
        mobiksBalance: user.mobiksBalance,
        parents: user.parentRelations.map((rel) => rel.parent),
        cards: user.cards.map((c) => this.formatCard(c)),
      },
      children: user.childRelations.map((rel) => ({
        id: rel.child.id,
        name: rel.child.name,
        phoneNumber: rel.child.phoneNumber,
        birthDay: rel.child.birthDay,
        role: rel.child.role,
        mobiksBalance: rel.child.mobiksBalance,
        cards: rel.child.cards.map((c) => this.formatCard(c)),
      })),
    };
  }

  /**
   * Удалить ребенка из семьи (вызывается родителем)
   */
  async removeChild(parentId: string, childId: string) {
    const relation = await this.prisma.familyRelation.findUnique({
      where: {
        parentId_childId: {
          parentId,
          childId,
        },
      },
      include: {
        child: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!relation) {
      throw new NotFoundException('Связь с ребенком не найдена в вашей семье');
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. Удаляем связь родитель-ребенок
      await tx.familyRelation.delete({
        where: {
          parentId_childId: {
            parentId,
            childId,
          },
        },
      });

      // 2. Проверяем, остались ли у родителя еще дети
      const remainingChildren = await tx.familyRelation.count({
        where: { parentId },
      });

      // Если других детей нет, сбрасываем роль PARENT на ORDINARY
      if (remainingChildren === 0) {
        await tx.user.update({
          where: { id: parentId },
          data: { role: UserRole.ORDINARY },
        });
      }
    });

    return {
      message: `Ребенок ${relation.child.name} успешно удален из семьи`,
      childId,
    };
  }

  /**
   * Отвязать родителя от ребенка (вызывается ребенком)
   */
  async removeParent(childId: string, parentId: string) {
    const relation = await this.prisma.familyRelation.findUnique({
      where: {
        parentId_childId: {
          parentId,
          childId,
        },
      },
      include: {
        parent: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!relation) {
      throw new NotFoundException('Связь с указанным родителем не найдена');
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. Удаляем связь родитель-ребенок
      await tx.familyRelation.delete({
        where: {
          parentId_childId: {
            parentId,
            childId,
          },
        },
      });

      // 2. Проверяем, остались ли у родителя еще дети
      const remainingChildren = await tx.familyRelation.count({
        where: { parentId },
      });

      // Если других детей нет, сбрасываем роль PARENT на ORDINARY
      if (remainingChildren === 0) {
        await tx.user.update({
          where: { id: parentId },
          data: { role: UserRole.ORDINARY },
        });
      }
    });

    return {
      message: `Родитель ${relation.parent.name} успешно отвязан`,
      parentId,
    };
  }

  /**
   * Универсальный метод удаления члена семьи (ребенка или родителя)
   */
  async removeFamilyMember(currentUserId: string, memberId: string) {
    // 1. Проверяем, является ли текущий пользователь родителем для memberId
    const asParent = await this.prisma.familyRelation.findUnique({
      where: {
        parentId_childId: {
          parentId: currentUserId,
          childId: memberId,
        },
      },
    });

    if (asParent) {
      return this.removeChild(currentUserId, memberId);
    }

    // 2. Проверяем, является ли текущий пользователь ребенком для memberId
    const asChild = await this.prisma.familyRelation.findUnique({
      where: {
        parentId_childId: {
          parentId: memberId,
          childId: currentUserId,
        },
      },
    });

    if (asChild) {
      return this.removeParent(currentUserId, memberId);
    }

    throw new NotFoundException('Связь между указанными членами семьи не найдена');
  }

  /**
   * Установить лимиты для покупок на карту ребенка (для родителя)
   */
  async updateCardLimits(parentId: string, cardId: string, dto: UpdateCardLimitsDto) {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      include: {
        user: true,
      },
    });

    if (!card) {
      throw new NotFoundException('Карта не найдена');
    }

    // Проверяем, что текущий пользователь является родителем владельца карты
    const relation = await this.prisma.familyRelation.findUnique({
      where: {
        parentId_childId: {
          parentId,
          childId: card.userId,
        },
      },
    });

    if (!relation) {
      throw new ForbiddenException(
        'Вы можете устанавливать лимиты только для карт своих детей',
      );
    }

    const updatedCard = await this.prisma.card.update({
      where: { id: cardId },
      data: {
        dailyLimit: dto.dailyLimit,
        ...(dto.allowOnlinePurchases !== undefined && {
          allowOnlinePurchases: dto.allowOnlinePurchases,
        }),
        ...(dto.allowCashWithdrawal !== undefined && {
          allowCashWithdrawal: dto.allowCashWithdrawal,
        }),
        ...(dto.isBlocked !== undefined && {
          isBlocked: dto.isBlocked,
        }),
      },
    });

    const dailyLimit = Number(updatedCard.dailyLimit);
    const spentToday = Number(updatedCard.spentToday);

    return {
      message: `Лимит для карты ребенка ${card.user.name} успешно обновлен`,
      card: {
        id: updatedCard.id,
        cardNumberMask: updatedCard.cardNumberMask,
        cardholderName: updatedCard.cardholderName,
        childName: card.user.name,
        type: updatedCard.type,
        balance: Number(updatedCard.balance),
        dailyLimit,
        spentToday,
        remainingDailyLimit: Math.max(0, dailyLimit - spentToday),
        allowOnlinePurchases: updatedCard.allowOnlinePurchases,
        allowCashWithdrawal: updatedCard.allowCashWithdrawal,
        isBlocked: updatedCard.isBlocked,
      },
    };
  }

  /**
   * Сбросить потраченную за сегодня сумму на карте ребенка
   */
  async resetSpentToday(parentId: string, cardId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      include: { user: true },
    });

    if (!card) {
      throw new NotFoundException('Карта не найдена');
    }

    const relation = await this.prisma.familyRelation.findUnique({
      where: {
        parentId_childId: {
          parentId,
          childId: card.userId,
        },
      },
    });

    if (!relation) {
      throw new ForbiddenException(
        'Вы можете управлять картами только своих детей',
      );
    }

    const updatedCard = await this.prisma.card.update({
      where: { id: cardId },
      data: { spentToday: 0 },
    });

    return {
      message: `Потраченная сумма за сегодня для карты ${card.user.name} сброшена`,
      card: {
        id: updatedCard.id,
        cardNumberMask: updatedCard.cardNumberMask,
        dailyLimit: Number(updatedCard.dailyLimit),
        spentToday: 0,
        remainingDailyLimit: Number(updatedCard.dailyLimit),
      },
    };
  }

  /**
   * Вспомогательный метод для форматирования данных карты
   */
  private formatCard(card: any) {
    const dailyLimit = Number(card.dailyLimit);
    const spentToday = Number(card.spentToday);
    return {
      id: card.id,
      cardNumberMask: card.cardNumberMask,
      cardholderName: card.cardholderName,
      expiryDate: card.expiryDate,
      type: card.type,
      balance: Number(card.balance),
      isBlocked: card.isBlocked,
      dailyLimit,
      spentToday,
      remainingDailyLimit: Math.max(0, dailyLimit - spentToday),
      allowOnlinePurchases: card.allowOnlinePurchases,
      allowCashWithdrawal: card.allowCashWithdrawal,
    };
  }

  /**
   * Получить список собственных карт текущего авторизованного пользователя (ребенка или родителя)
   */
  async getMyCards(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        cards: {
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    // Если у пользователя пока нет карт - автоматически выпускаем виртуальную карту
    if (user.cards.length === 0) {
      const randomLastDigits = Math.floor(1000 + Math.random() * 9000).toString();
      const defaultBalance =
        user.role === UserRole.ORDINARY || user.role === UserRole.PARENT
          ? 500.0
          : 50.0;
      const newCard = await this.prisma.card.create({
        data: {
          userId: user.id,
          cardNumberMask: `4258 •••• •••• ${randomLastDigits}`,
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
      user.cards = [newCard];
    }

    return user.cards.map((c) => this.formatCard(c));
  }

  /**
   * Получить детальную информацию по конкретной карте (включая последние транзакции)
   */
  async getCardById(userId: string, cardId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        user: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    if (!card) {
      throw new NotFoundException('Карта не найдена');
    }

    // Проверяем права: карта принадлежит пользователю ЛИБО пользователь - родитель владельца карты
    if (card.userId !== userId) {
      const isParent = await this.prisma.familyRelation.findUnique({
        where: {
          parentId_childId: {
            parentId: userId,
            childId: card.userId,
          },
        },
      });

      if (!isParent) {
        throw new ForbiddenException('У вас нет доступа к просмотру этой карты');
      }
    }

    const formatted = this.formatCard(card);
    return {
      ...formatted,
      transactions: card.transactions.map((t) => ({
        id: t.id,
        amount: Number(t.amount),
        merchant: t.merchant,
        category: t.category,
        status: t.status,
        createdAt: t.createdAt,
      })),
    };
  }

  /**
   * Получить статус прохождения квеста совершеннолетия («Квест 17.5: Путь к 18 🚀»)
   */
  async getGraduationStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        cards: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    // Рассчитываем возраст
    const now = new Date();
    const birth = new Date(user.birthDay);
    const ageDiffMs = now.getTime() - birth.getTime();
    const age = Math.round((ageDiffMs / (365.25 * 24 * 60 * 60 * 1000)) * 10) / 10;

    // Статистика в банке
    const completedPiggyBanksCount = await this.prisma.piggyBank.count({
      where: { ownerId: userId, status: PiggyBankStatus.COMPLETED },
    });

    const completedTasksCount = await this.prisma.task.count({
      where: {
        OR: [{ completedById: userId }, { assignedChildId: userId }],
        status: TaskStatus.COMPLETED,
      },
    });

    const transactionsCount = await this.prisma.transaction.count({
      where: { userId, status: TransactionStatus.SUCCESS },
    });

    // Чекпоинты готовности к взрослому банкингу
    const checkpoints = [
      {
        title: 'Банковский стаж',
        description: 'Возраст от 14 лет (статус подростка или совершеннолетнего)',
        isCompleted: age >= 14,
      },
      {
        title: 'Опыт накоплений',
        description: 'Хотя бы одна успешно закрытая цель в Копилке',
        isCompleted: completedPiggyBanksCount > 0,
      },
      {
        title: 'Трудолюбие и ответственность',
        description: 'Выполнено минимум 3 задания от родителей',
        isCompleted: completedTasksCount >= 3,
      },
      {
        title: 'Финансовая активность',
        description: 'Совершено не менее 5 успешных покупок по карте',
        isCompleted: transactionsCount >= 5,
      },
      {
        title: 'Бонусный капитал',
        description: 'Накоплено не менее 50 Мобиков',
        isCompleted: user.mobiksBalance >= 50,
      },
    ];

    const completedCheckpoints = checkpoints.filter((c) => c.isCompleted).length;
    const progressPercentage = Math.min(
      100,
      Math.max(
        15,
        Math.round(
          (age >= 17 ? 50 : (age / 18) * 40) +
            (completedCheckpoints / checkpoints.length) * 50,
        ),
      ),
    );

    const isEligibleForGraduation =
      user.role === UserRole.TEEN_14_17 || user.role === UserRole.CHILD_7_13;

    return {
      userId: user.id,
      userName: user.name,
      currentRole: user.role,
      age,
      progressPercentage,
      isEligibleForGraduation,
      completedPiggyBanksCount,
      completedTasksCount,
      mobiksBalance: user.mobiksBalance,
      transactionsCount,
      checkpoints,
    };
  }

  /**
   * Сценарий «Стать независимым пользователем банка (Переход 17 -> 18)»
   */
  async graduate(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        parentRelations: true,
        cards: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    if (user.role !== UserRole.TEEN_14_17 && user.role !== UserRole.CHILD_7_13) {
      throw new BadRequestException(
        'Пользователь уже является независимым совершеннолетним клиентом банка (роль ORDINARY)',
      );
    }

    const parentIds = user.parentRelations.map((r) => r.parentId);

    // Выполняем переход во взрослый банкинг в единой транзакции
    await this.prisma.$transaction(async (tx) => {
      // 1. Отвязываем всех родителей
      await tx.familyRelation.deleteMany({
        where: { childId: userId },
      });

      // 2. Для бывших родителей: если больше нет других детей, возвращаем роль ORDINARY
      for (const parentId of parentIds) {
        const remainingChildren = await tx.familyRelation.count({
          where: { parentId },
        });
        if (remainingChildren === 0) {
          await tx.user.update({
            where: { id: parentId },
            data: { role: UserRole.ORDINARY },
          });
        }
      }

      // 3. Обновляем роль пользователя на ORDINARY
      await tx.user.update({
        where: { id: userId },
        data: { role: UserRole.ORDINARY },
      });

      // 4. Снимаем детские ограничения со всех карт пользователя
      await tx.card.updateMany({
        where: { userId },
        data: {
          dailyLimit: 5000.0,
          allowOnlinePurchases: true,
          allowCashWithdrawal: true,
          isBlocked: false,
        },
      });
    });

    const updatedCards = await this.prisma.card.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
    });

    return {
      message:
        '🎉 Поздравляем с выпуском во взрослый банкинг! Вы стали независимым клиентом МТБанка. Все детские ограничения, родительский контроль и лимиты сняты. Ваши карты, сбережения, копилки и Мобики сохранены в полном объеме.',
      newRole: UserRole.ORDINARY,
      cards: updatedCards.map((c) => this.formatCard(c)),
    };
  }
}

