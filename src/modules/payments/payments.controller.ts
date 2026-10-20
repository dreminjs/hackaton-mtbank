import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import { PaymentsService } from './payments.service';
import {
  ApproveTransferRequestDto,
  ApproveTransferRequestResponseDto,
  CreateTransferRequestDto,
  CreateTransferRequestResponseDto,
  DeclineTransferRequestDto,
  DeclineTransferRequestResponseDto,
  PayQrDto,
  PayQrResponseDto,
  TransferRequestListItemDto,
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
}
