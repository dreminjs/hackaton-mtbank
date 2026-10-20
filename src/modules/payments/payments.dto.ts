import { createZodDto } from 'nestjs-zod';
import z from 'zod';

export const PayQrItemSchema = z.object({
  name: z.string().optional(),
  mcc: z.string().describe('MCC - Merchant Category Code'),
  amount: z.number().gte(0.01, 'Amount must be at least 1 kopek'),
});

export const PayQrSchema = z.object({
  merchant: z.string().min(1, 'Merchant is required'),
  cardId: z.string().optional(),
  // Либо список товаров, либо одиночный платеж (для обратной совместимости)
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

