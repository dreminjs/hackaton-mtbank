import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaymentsService } from './payments.service';
import {
  ApproveTransferRequestDto,
  ApproveTransferRequestResponseDto,
  CreateTransferRequestDto,
  CreateTransferRequestResponseDto,
  DeclineTransferRequestDto,
  DeclineTransferRequestResponseDto,
  FamilyTransactionsFeedResponseDto,
  MemberTransactionsResponseDto,
  PayQrDto,
  PayQrResponseDto,
  TransferRequestListItemDto,
  ParentToChildTransferDto,
  ParentToChildTransferResponseDto,
  P2pTransferByPhoneDto,
  P2pTransferResponseDto,
} from './payments.dto';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('qr')
  @ApiOperation({
    summary: 'Оплата по QR-коду с проверкой 18+ и дневных лимитов',
    description:
      'Проверяет категорию товаров, возраст ребенка и суточный лимит. При превышении отправляет на аппрув родителям.',
  })
  @ApiResponse({
    status: 200,
    description: 'Результат оплаты',
    type: PayQrResponseDto,
  })
  async payByQr(@Req() req: any, @Body() dto: PayQrDto) {
    const userId = req.user.id || req.user.sub;
    return this.paymentsService.payByQr(userId, dto);
  }

  @Post('transfer-requests')
  @ApiOperation({
    summary: 'Запрос ребенка на перевод денег у родителей',
    description:
      'Ребенок указывает сумму, карту для зачисления и комментарий (зачем нужны деньги: на кино, обед, книги и т.д.). Запрос становится доступен всем привязанным родителям.',
  })
  @ApiResponse({
    status: 201,
    description: 'Запрос на перевод успешно создан',
    type: CreateTransferRequestResponseDto,
  })
  async createTransferRequest(
    @Req() req: any,
    @Body() dto: CreateTransferRequestDto,
  ) {
    const childId = req.user.id || req.user.sub;
    return this.paymentsService.createTransferRequest(childId, dto);
  }

  @Get('transfer-requests')
  @ApiOperation({
    summary: 'Получить список запросов на перевод денег',
    description:
      'Если авторизован ребенок — возвращает его созданные запросы со статусами. Если родитель — возвращает запросы всех его детей.',
  })
  @ApiResponse({
    status: 200,
    description: 'Список запросов на перевод',
    type: [TransferRequestListItemDto],
  })
  async getTransferRequests(@Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.paymentsService.getTransferRequests(userId);
  }

  @Post('transfer-requests/:id/approve')
  @ApiOperation({
    summary: 'Одобрить перевод денег ребенку (для родителей)',
    description:
      'Родитель подтверждает перевод. Деньги атомарно списываются с карты родителя и зачисляются на карту ребенка, создаются истории транзакций.',
  })
  @ApiParam({ name: 'id', description: 'ID запроса на перевод' })
  @ApiResponse({
    status: 200,
    description: 'Перевод успешно выполнен',
    type: ApproveTransferRequestResponseDto,
  })
  async approveTransferRequest(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: ApproveTransferRequestDto,
  ) {
    const parentId = req.user.id || req.user.sub;
    return this.paymentsService.approveTransferRequest(parentId, id, dto);
  }

  @Post('transfer-requests/:id/decline')
  @ApiOperation({
    summary: 'Отклонить запрос на перевод денег (для родителей)',
    description:
      'Родитель отклоняет запрос с указанием причины (опционально).',
  })
  @ApiParam({ name: 'id', description: 'ID запроса на перевод' })
  @ApiResponse({
    status: 200,
    description: 'Запрос отклонен',
    type: DeclineTransferRequestResponseDto,
  })
  async declineTransferRequest(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: DeclineTransferRequestDto,
  ) {
    const parentId = req.user.id || req.user.sub;
    return this.paymentsService.declineTransferRequest(parentId, id, dto);
  }

  @Post('transfer/to-child')
  @ApiOperation({
    summary: 'Прямой перевод денег ребенку от родителя',
    description:
      'Родитель мгновенно переводит средства со своей карты на карту ребенка без предварительного запроса со стороны ребенка. Средства атомарно списываются с карты родителя и зачисляются ребенку. Создается история транзакций и отправляется WebSocket-уведомление ребенку.',
  })
  @ApiResponse({
    status: 200,
    description: 'Деньги успешно переведены ребенку',
    type: ParentToChildTransferResponseDto,
  })
  async transferToChild(
    @Req() req: any,
    @Body() dto: ParentToChildTransferDto,
  ) {
    const parentId = req.user.id || req.user.sub;
    return this.paymentsService.transferToChild(parentId, dto);
  }

  @Post('transfer/by-phone')
  @ApiOperation({
    summary: 'P2P-перевод денег по номеру телефона (для подростков и взрослых)',
    description:
      'Быстрый перевод денег другу или родственнику по номеру телефона (+375...). Списание с карты отправителя, зачисление на карту получателя, создание транзакций и отправка пуш-уведомления через WebSockets.',
  })
  @ApiResponse({
    status: 200,
    description: 'Перевод успешно выполнен',
    type: P2pTransferResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Недостаточно средств или перевод самому себе' })
  @ApiResponse({ status: 404, description: 'Получатель с таким номером телефона не найден' })
  async transferByPhone(
    @Req() req: any,
    @Body() dto: P2pTransferByPhoneDto,
  ) {
    const senderId = req.user.id || req.user.sub;
    return this.paymentsService.transferByPhone(senderId, dto);
  }

  @Get('transactions')
  @ApiOperation({
    summary: 'История собственных транзакций текущего пользователя',
    description: 'Возвращает историю платежей и списаний текущего пользователя с фильтрацией.',
  })
  @ApiQuery({ name: 'limit', required: false, example: 50, description: 'Количество записей' })
  @ApiQuery({ name: 'offset', required: false, example: 0, description: 'Смещение' })
  @ApiQuery({ name: 'cardId', required: false, description: 'Фильтр по карте' })
  @ApiQuery({ name: 'category', required: false, description: 'Фильтр по категории трат' })
  @ApiResponse({
    status: 200,
    description: 'История личных транзакций',
    type: MemberTransactionsResponseDto,
  })
  async getMyTransactions(
    @Req() req: any,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('cardId') cardId?: string,
    @Query('category') category?: string,
  ) {
    const userId = req.user.id || req.user.sub;
    return this.paymentsService.getMyTransactions(userId, {
      limit,
      offset,
      cardId,
      category,
    });
  }

  @Get('transactions/members/:memberId')
  @ApiOperation({
    summary: 'История транзакций члена семьи (ребенка или другого родителя)',
    description:
      'Позволяет просматривать расходы и операции конкретного члена семьи. Родитель может смотреть транзакции своего ребенка или второго родителя; ребенок может смотреть операции в рамках своей семьи.',
  })
  @ApiParam({ name: 'memberId', description: 'ID члена семьи (ребенка или другого родителя)' })
  @ApiQuery({ name: 'limit', required: false, example: 50, description: 'Количество записей' })
  @ApiQuery({ name: 'offset', required: false, example: 0, description: 'Смещение' })
  @ApiQuery({ name: 'cardId', required: false, description: 'Фильтр по карте' })
  @ApiQuery({ name: 'category', required: false, description: 'Фильтр по категории трат' })
  @ApiResponse({
    status: 200,
    description: 'История транзакций выбранного члена семьи',
    type: MemberTransactionsResponseDto,
  })
  async getMemberTransactions(
    @Req() req: any,
    @Param('memberId') memberId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('cardId') cardId?: string,
    @Query('category') category?: string,
  ) {
    const currentUserId = req.user.id || req.user.sub;
    return this.paymentsService.getMemberTransactions(currentUserId, memberId, {
      limit,
      offset,
      cardId,
      category,
    });
  }

  @Get('family/transactions')
  @ApiOperation({
    summary: 'Общая лента транзакций всей семьи (все дети и родители)',
    description:
      'Сводная лента расходов всех членов семьи в хронологическом порядке с указанием того, кто совершил покупку, суммы и магазина.',
  })
  @ApiQuery({ name: 'limit', required: false, example: 50, description: 'Количество записей' })
  @ApiQuery({ name: 'offset', required: false, example: 0, description: 'Смещение' })
  @ApiQuery({ name: 'category', required: false, description: 'Фильтр по категории трат' })
  @ApiResponse({
    status: 200,
    description: 'Общая семейная лента транзакций',
    type: FamilyTransactionsFeedResponseDto,
  })
  async getFamilyTransactions(
    @Req() req: any,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('category') category?: string,
  ) {
    const currentUserId = req.user.id || req.user.sub;
    return this.paymentsService.getFamilyTransactions(currentUserId, {
      limit,
      offset,
      category,
    });
  }
}
