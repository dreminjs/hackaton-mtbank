import { createZodDto } from 'nestjs-zod';
import z from 'zod';

export const PayQrSchema = z.object({
  merchant: z.string().min(1, 'Merchant is required'),
  mcc: z.string().min(1, 'MCC is required'),
  amount: z.number().gte(0.01, 'Amount must be at least 0.01'),
  cardId: z.string().optional(),
});

export class PayQrDto extends createZodDto(PayQrSchema) {}

export type TPayQrDto = z.infer<typeof PayQrSchema>;
