import * as z from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';
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

export class UserSummaryDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: '+375291234567' })
  phoneNumber: string;

  @ApiProperty({ example: 'Андрей Дрёмин' })
  name: string;
}

export class AuthResponseDto {
  @ApiProperty({ type: UserSummaryDto })
  user: UserSummaryDto;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  refreshToken: string;
}

export class TokensResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  refreshToken: string;
}

export class LogoutResponseDto {
  @ApiProperty({ example: true })
  success: boolean;
}

export class UserProfileDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  sub: string;

  @ApiProperty({ example: '+375291234567' })
  phoneNumber: string;

  @ApiProperty({ example: 'PARENT' })
  role?: string;
}

