import * as z from 'zod';
import { createZodDto } from 'nestjs-zod';

export const AddChildSchema = z.object({
  phoneNumber: z.string().min(5, 'Некорректный номер телефона'),
  password: z.string().min(6, 'Минимальная длина пароля — 6 символов'),
  name: z.string().min(1, 'Имя ребенка обязательно'),
  birthDay: z.iso.date({ message: 'Некорректная дата рождения (ГГГГ-ММ-ДД)' }),
  initialBalance: z.number().gte(0).optional().default(0),
  dailyLimit: z.number().gte(0).optional().default(15.0),
});

export const LinkChildSchema = z.object({
  phoneNumber: z.string().min(5, 'Некорректный номер телефона ребенка'),
});

export class AddChildDto extends createZodDto(AddChildSchema) {}
export class LinkChildDto extends createZodDto(LinkChildSchema) {}

export type AddChildInput = z.infer<typeof AddChildSchema>;
export type LinkChildInput = z.infer<typeof LinkChildSchema>;

export const UpdateCardLimitsSchema = z.object({
  dailyLimit: z
    .number()
    .gte(0, 'Ежедневный лимит не может быть отрицательным')
    .describe('Ежедневный лимит на сумму покупок в BYN'),
  allowOnlinePurchases: z.boolean().optional().describe('Разрешить онлайн-покупки'),
  allowCashWithdrawal: z.boolean().optional().describe('Разрешить снятие наличных'),
  isBlocked: z.boolean().optional().describe('Заблокировать / разблокировать карту'),
});

export class UpdateCardLimitsDto extends createZodDto(UpdateCardLimitsSchema) {}
export type UpdateCardLimitsInput = z.infer<typeof UpdateCardLimitsSchema>;
