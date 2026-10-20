import * as z from 'zod';
import { createZodDto } from 'nestjs-zod';
export const RegisterSchema = z.object({
  phoneNumber: z.string().min(5, 'Некорректный номер телефона'),
  password: z.string().min(6, 'Минимальная длина пароля — 6 символов'),
  name: z.string().min(1, 'Имя обязательно'),
  birthDay: z.iso.date({ message: 'Некорректная дата рождения (ГГГГ-ММ-ДД)' }),
});

export const LoginSchema = z.object({
  phoneNumber: z.string().min(5, 'Некорректный номер телефона'),
  password: z.string().min(1, 'Пароль обязателен'),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh токен обязателен'),
});

export class RegisterDto extends createZodDto(RegisterSchema) {}

export class LoginDto extends createZodDto(LoginSchema) {}
export class RefreshTokenDto extends createZodDto(RefreshTokenSchema) {}
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;
