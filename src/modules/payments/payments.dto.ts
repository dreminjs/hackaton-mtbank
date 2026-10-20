import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const PayQrItemSchema = z.object({
  name: z.string().optional(),
  mcc: z.string().describe('MCC - Merchant Category Code'),
  amount: z.number().gte(0.01, 'Amount must be at least 1 kopek'),
});

export const PayQrSchema = z.object({
  merchant: z.string().min(1, 'Merchant is required'),
  cardId: z.string().optional(),
  items: z.array(PayQrItemSchema).min(1, 'At least 1 item is required').optional(),
  mcc: z.string().optional(),
  amount: z.number().gte(0.01, 'Amount must be at least 1 kopek').optional(),
}).refine(
  (data) => (data.items && data.items.length > 0) || (data.mcc && data.amount),
  {
    message: 'Either items array or mcc and amount must be provided',
  },
);

export class PayQrDto extends createZodDto(PayQrSchema) { }

export type TPayQrItemDto = z.infer<typeof PayQrItemSchema>;
export type TPayQrDto = z.infer<typeof PayQrSchema>;

// Запрос на перевод денег у родителей
export const CreateTransferRequestSchema = z.object({
  amount: z.number().positive('Сумма перевода должна быть больше 0').min(0.01, 'Минимальная сумма — 0.01 BYN'),
  cardId: z.string().min(1, 'ID карты ребенка обязателен'),
  comment: z.string().min(1, 'Укажите комментарий, зачем нужен перевод').max(500, 'Комментарий не должен превышать 500 символов'),
});

export class CreateTransferRequestDto extends createZodDto(CreateTransferRequestSchema) { }
export type TCreateTransferRequestDto = z.infer<typeof CreateTransferRequestSchema>;

// Одобрение запроса родителем
export const ApproveTransferRequestSchema = z.object({
  parentCardId: z.string().optional().describe('ID карты родителя для списания (если не указана, выберется автоматически)'),
});

export class ApproveTransferRequestDto extends createZodDto(ApproveTransferRequestSchema) { }
export type TApproveTransferRequestDto = z.infer<typeof ApproveTransferRequestSchema>;

// Отклонение запроса родителем
export const DeclineTransferRequestSchema = z.object({
  reason: z.string().optional().describe('Причина отклонения запроса'),
});

export class DeclineTransferRequestDto extends createZodDto(DeclineTransferRequestSchema) { }
export type TDeclineTransferRequestDto = z.infer<typeof DeclineTransferRequestSchema>;

// --- Swagger Response Models ---

export class TransactionItemDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 12.5 })
  amount: number;

  @ApiProperty({ example: 'Школьная столовая' })
  merchant: string;

  @ApiProperty({ example: 'FOOD' })
  category: string;

  @ApiProperty({ example: 'SUCCESS' })
  status: string;

  @ApiProperty({ example: '2026-10-21T00:30:00.000Z' })
  createdAt: Date;
}

export class PayQrResponseDto {
  @ApiProperty({ example: 'SUCCESS' })
  status: string;

  @ApiProperty({ example: 'Оплата прошла успешно!' })
  message: string;

  @ApiProperty({ example: 12.5 })
  totalAmount: number;

  @ApiProperty({ example: 87.5 })
  newBalance: number;

  @ApiProperty({ example: 12.5 })
  spentToday: number;

  @ApiProperty({ example: 25.0 })
  dailyLimit: number;

  @ApiProperty({ type: [TransactionItemDto] })
  transactions: TransactionItemDto[];
}

export class TransferRequestCardDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: '4258 •••• •••• 1234' })
  cardNumberMask: string;

  @ApiProperty({ example: 'ИВАН ДРЁМИН', required: false })
  cardholderName?: string;

  @ApiProperty({ example: 'VIRTUAL', required: false })
  type?: string;

  @ApiProperty({ example: 50.0, required: false })
  balance?: number;
}

export class TransferRequestCreatedItemDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 15.0 })
  amount: number;

  @ApiProperty({ example: 'На обед в столовой' })
  comment: string;

  @ApiProperty({ example: 'PENDING' })
  status: string;

  @ApiProperty({ example: '2026-10-21T00:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ type: TransferRequestCardDto })
  card: TransferRequestCardDto;
}

export class CreateTransferRequestResponseDto {
  @ApiProperty({ example: 'Запрос на перевод денег успешно отправлен родителям' })
  message: string;

  @ApiProperty({ type: TransferRequestCreatedItemDto })
  transferRequest: TransferRequestCreatedItemDto;
}

export class TransferRequestUserShortDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 'Иван' })
  name: string;

  @ApiProperty({ example: '+375291234567', required: false })
  phoneNumber?: string;
}

export class TransferRequestListItemDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 15.0 })
  amount: number;

  @ApiProperty({ example: 'На обед в столовой' })
  comment: string;

  @ApiProperty({ example: 'PENDING' })
  status: string;

  @ApiProperty({ example: 'Недостаточно средств', required: false, nullable: true })
  declineReason?: string | null;

  @ApiProperty({ example: '2026-10-21T00:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-21T00:30:00.000Z' })
  updatedAt: Date;

  @ApiProperty({ type: TransferRequestUserShortDto, required: false })
  child?: TransferRequestUserShortDto;

  @ApiProperty({ type: TransferRequestCardDto })
  card: TransferRequestCardDto;

  @ApiProperty({ type: TransferRequestUserShortDto, required: false, nullable: true })
  resolvedBy?: TransferRequestUserShortDto | null;
}

export class TransferRequestResolvedItemDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 15.0 })
  amount: number;

  @ApiProperty({ example: 'На обед в столовой' })
  comment: string;

  @ApiProperty({ example: 'APPROVED' })
  status: string;

  @ApiProperty({ required: false })
  declineReason?: string;

  @ApiProperty({ type: TransferRequestUserShortDto, required: false })
  child?: TransferRequestUserShortDto;

  @ApiProperty({ type: TransferRequestCardDto })
  card: TransferRequestCardDto;

  @ApiProperty({ example: 250.0, required: false })
  parentCardBalance?: number;

  @ApiProperty({ type: TransferRequestUserShortDto, required: false, nullable: true })
  resolvedBy?: TransferRequestUserShortDto | null;
}

export class ApproveTransferRequestResponseDto {
  @ApiProperty({ example: 'Перевод успешно отправлен ребенку' })
  message: string;

  @ApiProperty({ type: TransferRequestResolvedItemDto })
  transferRequest: TransferRequestResolvedItemDto;
}

export class DeclineTransferRequestResponseDto {
  @ApiProperty({ example: 'Запрос на перевод отклонен' })
  message: string;

  @ApiProperty({ type: TransferRequestResolvedItemDto })
  transferRequest: TransferRequestResolvedItemDto;
}

// --- История транзакций членов семьи ---

export class TransactionUserDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 'Иван' })
  name: string;

  @ApiProperty({ example: '+375291234567', required: false })
  phoneNumber?: string;

  @ApiProperty({ example: 'CHILD_7_13', required: false })
  role?: string;
}

export class TransactionCardSummaryDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: '4258 •••• •••• 1234' })
  cardNumberMask: string;

  @ApiProperty({ example: 'VIRTUAL', required: false })
  type?: string;
}

export class DetailedTransactionDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 15.5 })
  amount: number;

  @ApiProperty({ example: 'Евроопт' })
  merchant: string;

  @ApiProperty({ example: 'FOOD' })
  category: string;

  @ApiProperty({
    example: 'SUCCESS',
    enum: [
      'SUCCESS',
      'DECLINED_BY_BANK',
      'DECLINED_BY_LIMIT',
      'PENDING_PARENT_APPROVAL',
    ],
  })
  status: string;

  @ApiProperty({ type: TransactionUserDto })
  user: TransactionUserDto;

  @ApiProperty({ type: TransactionCardSummaryDto })
  card: TransactionCardSummaryDto;

  @ApiProperty({ example: '2026-10-21T02:30:00.000Z' })
  createdAt: Date;
}

export class MemberTransactionsResponseDto {
  @ApiProperty({ type: TransactionUserDto })
  member: TransactionUserDto;

  @ApiProperty({ example: 145.2 })
  totalSpent: number;

  @ApiProperty({ example: 8 })
  transactionCount: number;

  @ApiProperty({ type: [DetailedTransactionDto] })
  transactions: DetailedTransactionDto[];
}

export class FamilyTransactionsFeedResponseDto {
  @ApiProperty({ example: 520.4 })
  familyTotalSpent: number;

  @ApiProperty({ example: 24 })
  totalCount: number;

  @ApiProperty({ type: [DetailedTransactionDto] })
  transactions: DetailedTransactionDto[];
}

