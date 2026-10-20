import {
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import {
  MarkAsReadResponseDto,
  NotificationDto,
  UnreadCountResponseDto,
} from './notifications.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Получить историю уведомлений родителя (покупки 18+, ночные покупки, лимиты)',
    description:
      'Возвращает список уведомлений для текущего авторизованного пользователя с деталями (кто из детей совершил покупку, магазин, сумма, категория, статус прочтения).',
  })
  @ApiResponse({
    status: 200,
    description: 'Список уведомлений',
    type: [NotificationDto],
  })
  async getNotifications(@Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.notificationsService.getNotifications(userId);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Количество непрочитанных уведомлений',
    description: 'Позволяет мобильному приложению отобразить красный бейдж со счетчиком новых уведомлений.',
  })
  @ApiResponse({
    status: 200,
    description: 'Количество непрочитанных уведомлений',
    type: UnreadCountResponseDto,
  })
  async getUnreadCount(@Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.notificationsService.getUnreadCount(userId);
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: 'Отметить конкретное уведомление как прочитанное',
  })
  @ApiParam({ name: 'id', description: 'ID уведомления' })
  @ApiResponse({
    status: 200,
    description: 'Уведомление отмечено как прочитанное',
    type: MarkAsReadResponseDto,
  })
  async markAsRead(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.id || req.user.sub;
    return this.notificationsService.markAsRead(userId, id);
  }

  @Patch('read-all')
  @ApiOperation({
    summary: 'Отметить все уведомления пользователя как прочитанные',
  })
  @ApiResponse({
    status: 200,
    description: 'Все уведомления отмечены как прочитанные',
    type: MarkAsReadResponseDto,
  })
  async markAllAsRead(@Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.notificationsService.markAllAsRead(userId);
  }
}
