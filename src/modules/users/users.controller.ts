import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { AddChildDto, LinkChildDto, UpdateCardLimitsDto } from './users.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('users / family')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('family/children')
  @ApiOperation({
    summary: 'Регистрация и добавление нового ребенка в семью',
    description:
      'Создает аккаунт ребенка, выпускает виртуальную карту, назначает роль CHILD_7_13 или TEEN_14_17 в зависимости от возраста, а родителю выставляет роль PARENT.',
  })
  @ApiResponse({ status: 201, description: 'Ребенок успешно зарегистрирован' })
  async addChild(@Req() req: any, @Body() dto: AddChildDto) {
    const parentId = req.user.id || req.user.sub;
    return this.usersService.addChild(parentId, dto);
  }

  @Post('family/link')
  @UseInterceptors(FileInterceptor('passport'))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({
    summary: 'Привязка существующего аккаунта ребенка по номеру телефона (со сканом паспорта)',
    description:
      'Ищет ребенка по номеру телефона, распознает скан паспорта через OCR Tesseract, сравнивает имена из паспорта и профиля пользователя. При совпадении привязывает ребенка и выставляет соответствующие роли.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        phoneNumber: { type: 'string', example: '+375291234567' },
        passport: {
          type: 'string',
          format: 'binary',
          description: 'Фото/скан разворота паспорта ребенка',
        },
      },
      required: ['phoneNumber'],
    },
  })
  @ApiResponse({ status: 200, description: 'Ребенок успешно привязан после проверки паспорта' })
  @ApiResponse({ status: 400, description: 'Несовпадение имени в паспорте или невалидные данные' })
  async linkChild(
    @Req() req: any,
    @Body() dto: LinkChildDto,
    @UploadedFile() passportFile?: Express.Multer.File,
  ) {
    const parentId = req.user.id || req.user.sub;
    return this.usersService.linkChild(parentId, dto, passportFile);
  }

  @Get('family')
  @ApiOperation({
    summary: 'Получить информацию о семье (родитель, дети и их карты)',
  })
  @ApiResponse({ status: 200, description: 'Информация о семье получена' })
  async getFamily(@Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.usersService.getFamily(userId);
  }

  @Delete('family/children/:childId')
  @ApiOperation({
    summary: 'Удалить ребенка из семьи (для родителя)',
    description:
      'Родитель отвязывает ребенка от своего аккаунта. Если у родителя больше нет других детей, его роль возвращается в ORDINARY.',
  })
  @ApiParam({ name: 'childId', description: 'ID ребенка' })
  @ApiResponse({ status: 200, description: 'Ребенок успешно удален из семьи' })
  async removeChild(@Req() req: any, @Param('childId') childId: string) {
    const parentId = req.user.id || req.user.sub;
    return this.usersService.removeChild(parentId, childId);
  }

  @Delete('family/parents/:parentId')
  @ApiOperation({
    summary: 'Отвязать родителя (для ребенка)',
    description:
      'Ребенок отвязывает конкретного родителя от своего профиля.',
  })
  @ApiParam({ name: 'parentId', description: 'ID родителя' })
  @ApiResponse({ status: 200, description: 'Родитель успешно отвязан' })
  async removeParent(@Req() req: any, @Param('parentId') parentId: string) {
    const childId = req.user.id || req.user.sub;
    return this.usersService.removeParent(childId, parentId);
  }

  @Delete('family/members/:memberId')
  @ApiOperation({
    summary: 'Универсальное удаление члена семьи (ребенка или родителя)',
    description:
      'Автоматически определяет отношение между текущим пользователем и memberId (родитель-ребенок или ребенок-родитель) и удаляет связь.',
  })
  @ApiParam({ name: 'memberId', description: 'ID удаляемого члена семьи' })
  @ApiResponse({ status: 200, description: 'Член семьи успешно удален' })
  async removeFamilyMember(@Req() req: any, @Param('memberId') memberId: string) {
    const currentUserId = req.user.id || req.user.sub;
    return this.usersService.removeFamilyMember(currentUserId, memberId);
  }

  @Patch('family/cards/:cardId/limits')
  @ApiOperation({
    summary: 'Установить ежедневный лимит на покупки и параметры карты ребенка (для родителя)',
    description:
      'Позволяет родителю задать суточный лимит расходов (в BYN) на покупки по карте ребенка, а также включить/отключить онлайн-платежи, снятие наличных или блокировку карты.',
  })
  @ApiParam({ name: 'cardId', description: 'ID карты ребенка' })
  @ApiResponse({ status: 200, description: 'Лимиты карты успешно обновлены' })
  async updateCardLimits(
    @Req() req: any,
    @Param('cardId') cardId: string,
    @Body() dto: UpdateCardLimitsDto,
  ) {
    const parentId = req.user.id || req.user.sub;
    return this.usersService.updateCardLimits(parentId, cardId, dto);
  }

  @Post('family/cards/:cardId/reset-spent')
  @ApiOperation({
    summary: 'Сбросить потраченную за сегодня сумму по карте ребенка (для родителя)',
    description:
      'Обнуляет spentToday на карте ребенка, возвращая доступный остаток дневного лимита к полному значению dailyLimit.',
  })
  @ApiParam({ name: 'cardId', description: 'ID карты ребенка' })
  @ApiResponse({ status: 200, description: 'Потраченная за сегодня сумма успешно сброшена' })
  async resetSpentToday(@Req() req: any, @Param('cardId') cardId: string) {
    const parentId = req.user.id || req.user.sub;
    return this.usersService.resetSpentToday(parentId, cardId);
  }
}
