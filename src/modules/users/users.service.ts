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
import { UserRole } from '#generated/prisma';

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
        parents: user.parentRelations.map((rel) => rel.parent),
        cards: user.cards,
      },
      children: user.childRelations.map((rel) => ({
        id: rel.child.id,
        name: rel.child.name,
        phoneNumber: rel.child.phoneNumber,
        birthDay: rel.child.birthDay,
        role: rel.child.role,
        cards: rel.child.cards,
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
}
