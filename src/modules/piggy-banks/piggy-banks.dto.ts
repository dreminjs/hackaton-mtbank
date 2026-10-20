import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const CreatePiggyBankSchema = z.object({
  title: z
    .string()
    .min(1, 'Название копилки обязательно')
    .describe('Название цели накопления (например: "PlayStation 5", "Новый велосипед", "Кроссовки")'),
  description: z
    .string()
    .optional()
    .describe('Описание цели (почему ребенок хочет это купить)'),
  targetAmount: z
    .number()
    .gte(1, 'Минимальная целевая сумма — 1 BYN')
    .describe('Целевая сумма накопления в BYN'),
  targetDate: z
    .string()
    .optional()
    .describe('Желаемая дата достижения цели (ISO-строка, например 2026-12-31)'),
  initialAmount: z
    .number()
    .gte(0.01)
    .optional()
    .describe('Начальный взнос с карты ребенка из карманных денег (опционально)'),
  cardId: z
    .string()
    .uuid('Некорректный ID карты')
    .optional()
    .describe('Карта ребенка для внесения начального взноса (если не указана, используется основная карта)'),
});

export class CreatePiggyBankDto extends createZodDto(CreatePiggyBankSchema) { }

export const UpdatePiggyBankSchema = z.object({
  title: z.string().min(1, 'Название копилки обязательно').optional(),
  description: z.string().optional(),
  targetAmount: z.number().gte(1, 'Минимальная целевая сумма — 1 BYN').optional(),
  targetDate: z.string().nullable().optional(),
});

export class UpdatePiggyBankDto extends createZodDto(UpdatePiggyBankSchema) { }

export const TopUpPiggyBankSchema = z.object({
  amount: z
    .number()
    .gte(0.1, 'Минимальная сумма пополнения — 0.10 BYN')
    .describe('Сумма пополнения копилки в BYN'),
  comment: z
    .string()
    .optional()
    .describe('Пожелание, поздравление или комментарий (например: "От папы на день рождения! Ты молодец!")'),
  cardId: z
    .string()
    .uuid('Некорректный ID карты')
    .optional()
    .describe('Карта, с которой списываются деньги (если не указана — берется основная карта пополняющего)'),
});

export class TopUpPiggyBankDto extends createZodDto(TopUpPiggyBankSchema) { }

export const WithdrawPiggyBankSchema = z.object({
  cardId: z
    .string()
    .uuid('Некорректный ID карты')
    .optional()
    .describe('Карта ребенка для зачисления накопленной суммы. Если не указана — берется основная карта'),
  breakPiggyBank: z
    .boolean()
    .optional()
    .default(false)
    .describe('Разбить копилку досрочно (статус BROKEN) или завершить цель (COMPLETED)'),
});

export class WithdrawPiggyBankDto extends createZodDto(WithdrawPiggyBankSchema) { }

// --- Swagger Response Models ---

export class PiggyBankUserShortDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 'Иван' })
  name: string;

  @ApiProperty({ example: '+375291234567', required: false })
  phoneNumber?: string;

  @ApiProperty({ example: 'CHILD_7_13' })
  role: string;
}

export class PiggyBankContributionDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 25.0 })
  amount: number;

  @ApiProperty({ example: 'От папы на мечту! Молодец!', required: false, nullable: true })
  comment?: string | null;

  @ApiProperty({ example: '2026-10-21T10:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ type: PiggyBankUserShortDto })
  user: PiggyBankUserShortDto;

  @ApiProperty({ example: '4258 •••• •••• 1234', required: false, nullable: true })
  cardNumberMask?: string | null;
}

export class PiggyBankResponseDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 'PlayStation 5' })
  title: string;

  @ApiProperty({ example: 'Коплю на приставку к Новому Году', required: false, nullable: true })
  description?: string | null;

  @ApiProperty({ example: 500.0 })
  targetAmount: number;

  @ApiProperty({ example: 175.0 })
  currentAmount: number;

  @ApiProperty({ example: 325.0 })
  remainingAmount: number;

  @ApiProperty({ example: 35.0 })
  progressPercentage: number;

  @ApiProperty({ example: false })
  isGoalReached: boolean;

  @ApiProperty({ example: '2026-12-31T00:00:00.000Z', required: false, nullable: true })
  targetDate?: Date | null;

  @ApiProperty({ example: 'ACTIVE', enum: ['ACTIVE', 'COMPLETED', 'BROKEN'] })
  status: string;

  @ApiProperty({ type: PiggyBankUserShortDto })
  owner: PiggyBankUserShortDto;

  @ApiProperty({ type: [PiggyBankContributionDto] })
  contributions: PiggyBankContributionDto[];

  @ApiProperty({ example: '2026-10-21T10:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-21T10:00:00.000Z' })
  updatedAt: Date;
}

export class CreatePiggyBankResponseDto {
  @ApiProperty({ example: 'Копилка "PlayStation 5" успешно создана!' })
  message: string;

  @ApiProperty({ type: PiggyBankResponseDto })
  piggyBank: PiggyBankResponseDto;
}

export class TopUpPiggyBankResponseDto {
  @ApiProperty({ example: 'Копилка успешно пополнена на 50 BYN! Текущая сумма: 225 BYN' })
  message: string;

  @ApiProperty({ example: 450.0 })
  senderCardBalance: number;

  @ApiProperty({ type: PiggyBankResponseDto })
  piggyBank: PiggyBankResponseDto;
}

export class WithdrawPiggyBankResponseDto {
  @ApiProperty({ example: 'Средства из копилки в размере 500 BYN успешно зачислены на карту ребенка!' })
  message: string;

  @ApiProperty({ example: 500.0 })
  withdrawnAmount: number;

  @ApiProperty({ example: 565.0 })
  childCardBalance: number;

  @ApiProperty({ type: PiggyBankResponseDto })
  piggyBank: PiggyBankResponseDto;
}
