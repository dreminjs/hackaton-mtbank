import { ApiProperty } from '@nestjs/swagger';

export class NotificationChildShortDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 'Иван' })
  name: string;

  @ApiProperty({ example: '+375291234567', required: false })
  phoneNumber?: string;
}

export class NotificationDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({
    example: 'RESTRICTED_18_PURCHASE',
    enum: [
      'RESTRICTED_18_PURCHASE',
      'NIGHT_PURCHASE',
      'LIMIT_EXCEEDED',
      'TRANSFER_REQUEST',
      'TASK_SUBMITTED',
      'PIGGY_BANK_TOPUP',
    ],
  })
  type: string;

  @ApiProperty({ example: '⚠️ Попытка покупки 18+ товара!' })
  title: string;

  @ApiProperty({
    example:
      'Ребенок Иван пытался оплатить товар категории «Алкоголь и табак» (18+) в магазине «Евроопт» на сумму 15.50 BYN. Покупка заблокирована.',
  })
  message: string;

  @ApiProperty({ example: false })
  isRead: boolean;

  @ApiProperty({
    example: {
      childId: 'b3f5c71a-47d2-432a-bc91-382940294821',
      childName: 'Иван',
      merchant: 'Евроопт',
      amount: 15.5,
      mcc: '5921',
      category: 'RESTRICTED_18',
    },
    required: false,
    nullable: true,
  })
  data?: any;

  @ApiProperty({ type: NotificationChildShortDto, required: false, nullable: true })
  child?: NotificationChildShortDto | null;

  @ApiProperty({ example: '2026-10-21T02:45:00.000Z' })
  createdAt: Date;
}

export class UnreadCountResponseDto {
  @ApiProperty({ example: 3 })
  unreadCount: number;
}

export class MarkAsReadResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Уведомление отмечено как прочитанное' })
  message: string;
}
