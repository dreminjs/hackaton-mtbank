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
