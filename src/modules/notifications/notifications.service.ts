import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationType } from '#generated/prisma';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  /**
   * Отправить уведомление всем родителям ребенка (сохранение в БД + WebSockets)
   */
  async notifyParents(
    childId: string,
    alert: {
      type: NotificationType;
      title: string;
      message: string;
      data?: any;
    },
  ) {
    // Находим всех привязанных родителей ребенка
    const relations = await this.prisma.familyRelation.findMany({
      where: { childId },
      include: {
        parent: {
          select: { id: true, name: true, phoneNumber: true },
        },
        child: {
          select: { id: true, name: true, phoneNumber: true },
        },
      },
    });

    if (!relations.length) {
      this.logger.warn(`У ребенка ${childId} нет привязанных родителей для отправки уведомления`);
      return [];
    }

    const createdNotifications: any[] = [];

    for (const rel of relations) {
      const parentId = rel.parentId;

      // 1. Сохраняем уведомление в БД (для HTTP GET /notifications)
      const notification = await this.prisma.notification.create({
        data: {
          type: alert.type,
          title: alert.title,
          message: alert.message,
          data: alert.data || {},
          userId: parentId,
          childId: childId,
        },
        include: {
          child: {
            select: { id: true, name: true, phoneNumber: true },
          },
        },
      });

      createdNotifications.push(notification);

      // 2. Отсылаем мгновенное push-уведомление через WebSockets (Socket.IO)
      this.gateway.sendToUser(parentId, 'notification', notification);

      // Дополнительно отправляем специфичное событие для мобильного клиента
      if (alert.type === NotificationType.RESTRICTED_18_PURCHASE) {
        this.gateway.sendToUser(parentId, 'restricted_purchase_alert', notification);
      } else if (alert.type === NotificationType.NIGHT_PURCHASE) {
        this.gateway.sendToUser(parentId, 'night_purchase_alert', notification);
      }
    }

    return createdNotifications;
  }

  /**
   * Получить список всех уведомлений текущего пользователя (родителя)
   */
  async getNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      include: {
        child: {
          select: { id: true, name: true, phoneNumber: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Получить количество непрочитанных уведомлений
   */
  async getUnreadCount(userId: string) {
    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { unreadCount };
  }

  /**
   * Отметить конкретное уведомление как прочитанное
   */
  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Уведомление не найдено');
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });

    return { success: true, message: 'Уведомление отмечено как прочитанное' };
  }

  /**
   * Отметить все уведомления пользователя как прочитанные
   */
  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return { success: true, message: 'Все уведомления отмечены как прочитанные' };
  }
}
