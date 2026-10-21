import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTaskDto,
  RejectTaskDto,
  SubmitTaskDto,
  UpdateTaskDto,
  RequestNewTaskDto,
} from './tasks.dto';
import { NotificationType, TaskStatus, UserRole } from '#generated/prisma';
import { NotificationsGateway } from '../notifications/notifications.gateway';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  /**
   * Преобразование сущности Task в удобный формат с числами вместо Decimal
   */
  private formatTask(task: any) {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      rewardAmount: Number(task.rewardAmount),
      deadline: task.deadline,
      status: task.status,
      creator: {
        id: task.creator.id,
        name: task.creator.name,
        phoneNumber: task.creator.phoneNumber,
        role: task.creator.role,
      },
      creatorCard: task.creatorCard
        ? {
            id: task.creatorCard.id,
            cardNumberMask: task.creatorCard.cardNumberMask,
            cardholderName: task.creatorCard.cardholderName,
          }
        : null,
      assignedChild: task.assignedChild
        ? {
            id: task.assignedChild.id,
            name: task.assignedChild.name,
            phoneNumber: task.assignedChild.phoneNumber,
            role: task.assignedChild.role,
          }
        : null,
      completedBy: task.completedBy
        ? {
            id: task.completedBy.id,
            name: task.completedBy.name,
            phoneNumber: task.completedBy.phoneNumber,
            role: task.completedBy.role,
          }
        : null,
      targetCard: task.targetCard
        ? {
            id: task.targetCard.id,
            cardNumberMask: task.targetCard.cardNumberMask,
            cardholderName: task.targetCard.cardholderName,
          }
        : null,
      submissionComment: task.submissionComment,
      photoUrl: task.photoUrl,
      submittedAt: task.submittedAt,
      rejectionReason: task.rejectionReason,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  /**
   * Найти или автоматически выпустить карту для пользователя
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

    // Если у пользователя нет карт — выпускаем виртуальную карту
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    const randomLastDigits = Math.floor(1000 + Math.random() * 9000).toString();
    const defaultBalance =
      user.role === UserRole.CHILD_7_13 || user.role === UserRole.TEEN_14_17
        ? 50.0
        : 500.0;

    return this.prisma.card.create({
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
  }

  /**
   * Создать задачу с денежным вознаграждением (для родителя)
   * Деньги сразу списываются (замораживаются в эскроу) с карты родителя.
   */
  async createTask(parentId: string, dto: CreateTaskDto) {
    const parent = await this.prisma.user.findUnique({
      where: { id: parentId },
      include: {
        childRelations: true,
      },
    });

    if (!parent) {
      throw new NotFoundException('Родитель не найден');
    }

    // Если задача персональная — проверяем, что ребенок связан с родителем
    if (dto.assignedChildId) {
      const isRelated = parent.childRelations.some(
        (rel) => rel.childId === dto.assignedChildId,
      );
      if (!isRelated) {
        throw new ForbiddenException(
          'Назначенный пользователь не является ребенком в вашей семье',
        );
      }
    }

    // Находим карту родителя для списания
    const parentCard = await this.getOrCreateCard(parentId, dto.creatorCardId);

    if (parentCard.isBlocked) {
      throw new BadRequestException('Указанная карта родителя заблокирована');
    }

    const currentBalance = Number(parentCard.balance);
    if (currentBalance < dto.rewardAmount) {
      throw new BadRequestException(
        `Недостаточно средств на карте для создания задачи. Требуется: ${dto.rewardAmount.toFixed(2)} BYN, текущий баланс: ${currentBalance.toFixed(2)} BYN`,
      );
    }

    const [updatedCard, createdTask] = await this.prisma.$transaction(
      async (tx) => {
        // 1. Списываем сумму вознаграждения с карты родителя
        const cardAfterDebit = await tx.card.update({
          where: { id: parentCard.id },
          data: {
            balance: {
              decrement: dto.rewardAmount,
            },
          },
        });

        // 2. Создаем транзакцию списания
        await tx.transaction.create({
          data: {
            userId: parentId,
            cardId: parentCard.id,
            amount: dto.rewardAmount,
            merchant: `MTBank Задания: ${dto.title}`,
            category: 'TASK_REWARD',
            status: 'SUCCESS',
          },
        });

        // 3. Создаем запись задачи
        const task = await tx.task.create({
          data: {
            title: dto.title,
            description: dto.description || null,
            rewardAmount: dto.rewardAmount,
            deadline: dto.deadline ? new Date(dto.deadline) : null,
            status: dto.assignedChildId
              ? TaskStatus.IN_PROGRESS
              : TaskStatus.OPEN,
            creatorId: parentId,
            creatorCardId: parentCard.id,
            assignedChildId: dto.assignedChildId || null,
          },
          include: {
            creator: true,
            creatorCard: true,
            assignedChild: true,
            completedBy: true,
            targetCard: true,
          },
        });

        return [cardAfterDebit, task];
      },
    );

    return {
      message: `Задача "${createdTask.title}" успешно создана. Вознаграждение ${dto.rewardAmount.toFixed(2)} BYN зарезервировано с карты родителя`,
      parentCardBalance: Number(updatedCard.balance),
      task: this.formatTask(createdTask),
    };
  }

  /**
   * Редактировать задачу (контент, сумма, дедлайн, назначенный ребенок)
   * При изменении суммы: списывается доплата или возвращается разница.
   */
  async updateTask(parentId: string, taskId: string, dto: UpdateTaskDto) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        creator: true,
        creatorCard: true,
        assignedChild: true,
        completedBy: true,
        targetCard: true,
      },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }

    if (task.creatorId !== parentId) {
      throw new ForbiddenException('Вы можете редактировать только свои задачи');
    }

    if (task.status === TaskStatus.COMPLETED) {
      throw new BadRequestException('Нельзя редактировать уже выполненную задачу');
    }

    if (task.status === TaskStatus.CANCELLED) {
      throw new BadRequestException('Нельзя редактировать отмененную задачу');
    }

    // Если меняется ребенок
    if (dto.assignedChildId) {
      const isRelated = await this.prisma.familyRelation.findUnique({
        where: {
          parentId_childId: {
            parentId,
            childId: dto.assignedChildId,
          },
        },
      });
      if (!isRelated) {
        throw new ForbiddenException(
          'Назначенный пользователь не является ребенком в вашей семье',
        );
      }
    }

    const oldAmount = Number(task.rewardAmount);
    const newAmount =
      dto.rewardAmount !== undefined ? dto.rewardAmount : oldAmount;
    const diff = Number((newAmount - oldAmount).toFixed(2));

    const updatedTask = await this.prisma.$transaction(async (tx) => {
      // Если сумма увеличилась — списываем доплату
      if (diff > 0) {
        const parentCard = await this.getOrCreateCard(
          parentId,
          dto.creatorCardId || task.creatorCardId || undefined,
        );

        if (parentCard.isBlocked) {
          throw new BadRequestException('Карта родителя заблокирована');
        }

        if (Number(parentCard.balance) < diff) {
          throw new BadRequestException(
            `Недостаточно средств для увеличения награды. Требуется доплатить: ${diff.toFixed(2)} BYN, баланс: ${Number(parentCard.balance).toFixed(2)} BYN`,
          );
        }

        await tx.card.update({
          where: { id: parentCard.id },
          data: { balance: { decrement: diff } },
        });

        await tx.transaction.create({
          data: {
            userId: parentId,
            cardId: parentCard.id,
            amount: diff,
            merchant: `Доплата за задание: ${dto.title || task.title}`,
            category: 'TASK_REWARD',
            status: 'SUCCESS',
          },
        });
      }

      // Если сумма уменьшилась — возвращаем разницу
      if (diff < 0) {
        const refund = Math.abs(diff);
        const cardToRefund = await this.getOrCreateCard(
          parentId,
          task.creatorCardId || undefined,
        );

        await tx.card.update({
          where: { id: cardToRefund.id },
          data: { balance: { increment: refund } },
        });

        await tx.transaction.create({
          data: {
            userId: parentId,
            cardId: cardToRefund.id,
            amount: refund,
            merchant: `Возврат разницы за задание: ${dto.title || task.title}`,
            category: 'TASK_REWARD',
            status: 'SUCCESS',
          },
        });
      }

      return tx.task.update({
        where: { id: taskId },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.rewardAmount !== undefined && { rewardAmount: dto.rewardAmount }),
          ...(dto.deadline !== undefined && {
            deadline: dto.deadline ? new Date(dto.deadline) : null,
          }),
          ...(dto.assignedChildId !== undefined && {
            assignedChildId: dto.assignedChildId,
            status: dto.assignedChildId
              ? TaskStatus.IN_PROGRESS
              : TaskStatus.OPEN,
          }),
        },
        include: {
          creator: true,
          creatorCard: true,
          assignedChild: true,
          completedBy: true,
          targetCard: true,
        },
      });
    });

    return this.formatTask(updatedTask);
  }

  /**
   * Получить список задач (для родителя или ребенка)
   */
  async getTasks(userId: string, statusFilter?: TaskStatus) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        childRelations: true,
        parentRelations: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    const isChild =
      user.role === UserRole.CHILD_7_13 || user.role === UserRole.TEEN_14_17;

    let whereClause: any = {};

    if (isChild) {
      // Для ребенка: задачи от родителей семьи, которые назначены на него ИЛИ открыты для всех
      const parentIds = user.parentRelations.map((rel) => rel.parentId);

      whereClause = {
        creatorId: { in: parentIds },
        OR: [{ assignedChildId: userId }, { assignedChildId: null }],
        ...(statusFilter && { status: statusFilter }),
      };
    } else {
      // Для родителя: задачи, созданные им
      whereClause = {
        creatorId: userId,
        ...(statusFilter && { status: statusFilter }),
      };
    }

    const tasks = await this.prisma.task.findMany({
      where: whereClause,
      include: {
        creator: true,
        creatorCard: true,
        assignedChild: true,
        completedBy: true,
        targetCard: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return tasks.map((t) => this.formatTask(t));
  }

  /**
   * Получить конкретную задачу по ID
   */
  async getTaskById(userId: string, taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        creator: true,
        creatorCard: true,
        assignedChild: true,
        completedBy: true,
        targetCard: true,
      },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }

    return this.formatTask(task);
  }

  /**
   * Ребенок отправляет отчет о выполнении задачи родителям на проверку
   */
  async submitTask(childId: string, taskId: string, dto: SubmitTaskDto) {
    const child = await this.prisma.user.findUnique({
      where: { id: childId },
      include: { parentRelations: true },
    });

    if (!child) {
      throw new NotFoundException('Пользователь не найден');
    }

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }

    if (task.status === TaskStatus.COMPLETED) {
      throw new BadRequestException('Задача уже была выполнена и подтверждена');
    }

    if (task.status === TaskStatus.CANCELLED) {
      throw new BadRequestException('Задача была отменена родителем');
    }

    // Проверяем, что ребенок может сдать эту задачу
    if (task.assignedChildId && task.assignedChildId !== childId) {
      throw new ForbiddenException(
        'Эта задача персонально назначена другому ребенку',
      );
    }

    // Если задача была открытой — проверяем, что ребенок в семье создателя
    if (!task.assignedChildId) {
      const isFamilyChild = child.parentRelations.some(
        (rel) => rel.parentId === task.creatorId,
      );
      if (!isFamilyChild) {
        throw new ForbiddenException(
          'Вы можете выполнять задачи только родителей из своей семьи',
        );
      }
    }

    // Находим карту ребенка для зачисления будущей награды
    const targetCard = await this.getOrCreateCard(childId, dto.targetCardId);

    const updatedTask = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.SUBMITTED,
        completedById: childId,
        targetCardId: targetCard.id,
        submissionComment: dto.comment || null,
        photoUrl: dto.photoUrl || null,
        submittedAt: new Date(),
        rejectionReason: null,
      },
      include: {
        creator: true,
        creatorCard: true,
        assignedChild: true,
        completedBy: true,
        targetCard: true,
      },
    });

    return {
      message: 'Отчет о выполнении задачи успешно отправлен родителям на проверку',
      task: this.formatTask(updatedTask),
    };
  }

  /**
   * Родитель подтверждает выполнение задачи: вознаграждение перечисляется ребенку на карту
   */
  async approveTask(parentId: string, taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        creator: true,
        creatorCard: true,
        assignedChild: true,
        completedBy: true,
        targetCard: true,
      },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }

    if (task.creatorId !== parentId) {
      throw new ForbiddenException('Вы можете подтверждать только свои задачи');
    }

    if (task.status !== TaskStatus.SUBMITTED) {
      throw new BadRequestException(
        'Задача не находится на проверке (статус должен быть SUBMITTED)',
      );
    }

    if (!task.completedById) {
      throw new BadRequestException('Исполнитель задачи не определен');
    }

    const reward = Number(task.rewardAmount);

    // Находим карту ребенка для зачисления
    const targetCard = await this.getOrCreateCard(
      task.completedById,
      task.targetCardId || undefined,
    );

    const [updatedCard, completedTask] = await this.prisma.$transaction(
      async (tx) => {
        // 1. Зачисляем деньги ребенку
        const cardAfterCredit = await tx.card.update({
          where: { id: targetCard.id },
          data: {
            balance: {
              increment: reward,
            },
          },
        });

        // 2. Создаем транзакцию зачисления
        await tx.transaction.create({
          data: {
            userId: task.completedById!,
            cardId: targetCard.id,
            amount: reward,
            merchant: `Награда за выполнение задания: ${task.title}`,
            category: 'TASK_REWARD',
            status: 'SUCCESS',
          },
        });

        // 3. Переводим задачу в статус COMPLETED
        const finished = await tx.task.update({
          where: { id: taskId },
          data: {
            status: TaskStatus.COMPLETED,
          },
          include: {
            creator: true,
            creatorCard: true,
            assignedChild: true,
            completedBy: true,
            targetCard: true,
          },
        });

        return [cardAfterCredit, finished];
      },
    );

    return {
      message: `Выполнение задачи подтверждено! Вознаграждение ${reward.toFixed(2)} BYN зачислено на карту ребенка ${completedTask.completedBy?.name}`,
      childCardBalance: Number(updatedCard.balance),
      task: this.formatTask(completedTask),
    };
  }

  /**
   * Родитель отклоняет выполнение задачи / отправляет на доработку с причиной
   */
  async rejectTask(parentId: string, taskId: string, dto: RejectTaskDto) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        creator: true,
        creatorCard: true,
        assignedChild: true,
        completedBy: true,
        targetCard: true,
      },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }

    if (task.creatorId !== parentId) {
      throw new ForbiddenException('Вы можете отклонять только свои задачи');
    }

    if (task.status !== TaskStatus.SUBMITTED) {
      throw new BadRequestException(
        'Отклонить можно только задачу, отправленную на проверку (SUBMITTED)',
      );
    }

    const updatedTask = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: task.assignedChildId
          ? TaskStatus.IN_PROGRESS
          : TaskStatus.OPEN,
        rejectionReason: dto.reason,
      },
      include: {
        creator: true,
        creatorCard: true,
        assignedChild: true,
        completedBy: true,
        targetCard: true,
      },
    });

    return {
      message: 'Задача отправлена ребенку на доработку с указанием замечаний',
      task: this.formatTask(updatedTask),
    };
  }

  /**
   * Родитель отменяет задачу: зарезервированные деньги возвращаются на карту родителя
   */
  async cancelTask(parentId: string, taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        creator: true,
        creatorCard: true,
        assignedChild: true,
        completedBy: true,
        targetCard: true,
      },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }

    if (task.creatorId !== parentId) {
      throw new ForbiddenException('Вы можете отменять только свои задачи');
    }

    if (task.status === TaskStatus.COMPLETED) {
      throw new BadRequestException('Нельзя отменить уже выполненную задачу');
    }

    if (task.status === TaskStatus.CANCELLED) {
      throw new BadRequestException('Задача уже была отменена');
    }

    const reward = Number(task.rewardAmount);
    const parentCard = await this.getOrCreateCard(
      parentId,
      task.creatorCardId || undefined,
    );

    const [updatedCard, cancelledTask] = await this.prisma.$transaction(
      async (tx) => {
        // 1. Возвращаем деньги родителю
        const cardAfterRefund = await tx.card.update({
          where: { id: parentCard.id },
          data: {
            balance: {
              increment: reward,
            },
          },
        });

        // 2. Создаем транзакцию возврата
        await tx.transaction.create({
          data: {
            userId: parentId,
            cardId: parentCard.id,
            amount: reward,
            merchant: `Возврат средств за отмену задания: ${task.title}`,
            category: 'TASK_REWARD',
            status: 'SUCCESS',
          },
        });

        // 3. Переводим задачу в статус CANCELLED
        const cancelled = await tx.task.update({
          where: { id: taskId },
          data: {
            status: TaskStatus.CANCELLED,
          },
          include: {
            creator: true,
            creatorCard: true,
            assignedChild: true,
            completedBy: true,
            targetCard: true,
          },
        });

        return [cardAfterRefund, cancelled];
      },
    );

    return {
      message: `Задача "${cancelledTask.title}" отменена. Вознаграждение ${reward.toFixed(2)} BYN возвращено на карту родителя`,
      parentCardBalance: Number(updatedCard.balance),
      task: this.formatTask(cancelledTask),
    };
  }

  /**
   * Ребенок просит новое задание у родителей («Попросить новое задание у родителей»)
   */
  async requestNewTask(childId: string, dto: RequestNewTaskDto) {
    const child = await this.prisma.user.findUnique({
      where: { id: childId },
      include: {
        parentRelations: {
          include: {
            parent: {
              select: { id: true, name: true, phoneNumber: true },
            },
          },
        },
      },
    });

    if (!child) {
      throw new NotFoundException('Пользователь не найден');
    }

    if (
      child.role !== UserRole.CHILD_7_13 &&
      child.role !== UserRole.TEEN_14_17
    ) {
      throw new BadRequestException('Запрашивать задания у родителей могут только дети');
    }

    if (child.parentRelations.length === 0) {
      throw new BadRequestException('У вас нет привязанных родителей для запроса заданий');
    }

    const commentText = dto.comment?.trim() || '';

    // Отправляем уведомление каждому родителю
    for (const rel of child.parentRelations) {
      const parentId = rel.parentId;

      // 1. Сохраняем уведомление в БД
      try {
        await this.prisma.notification.create({
          data: {
            type: NotificationType.TASK_REQUESTED,
            title: '🎯 Новое задание для ребенка',
            message: `Ребенок ${child.name} просит дать ему новое задание!${commentText ? ` («${commentText}»)` : ''}`,
            data: {
              childId: child.id,
              childName: child.name,
              comment: commentText,
            },
            userId: parentId,
            childId: child.id,
          },
        });
      } catch (e) {
        // Игнорируем ошибку базы данных
      }

      // 2. Отправляем через Socket.IO
      try {
        const socketPayload = {
          type: 'TASK_REQUESTED',
          title: '🎯 Ребенок просит задание!',
          message: `${child.name} просит дать новое задание с вознаграждением${commentText ? `: «${commentText}»` : ''}`,
          childId: child.id,
          childName: child.name,
          comment: commentText,
          createdAt: new Date().toISOString(),
        };

        this.notificationsGateway.sendToUser(parentId, 'task_requested', socketPayload);
        this.notificationsGateway.sendToUser(parentId, 'notification', socketPayload);
      } catch (e) {
        // Игнорируем ошибку сокетов
      }
    }

    return {
      message: 'Запрос на новое задание успешно отправлен родителям!',
      comment: dto.comment,
      notifiedParentsCount: child.parentRelations.length,
    };
  }
}

