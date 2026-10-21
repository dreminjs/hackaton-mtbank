import * as z from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

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
  pocketMoneyAmount: z
    .number()
    .gte(0, 'Сумма карманных не может быть отрицательной')
    .optional()
    .describe('Сумма регулярного автоперевода карманных денег в BYN'),
  pocketMoneyDay: z
    .number()
    .int()
    .min(1)
    .max(7)
    .optional()
    .describe('День недели автоперевода карманных денег (1 — понедельник, 7 — воскресенье)'),
});

export class UpdateCardLimitsDto extends createZodDto(UpdateCardLimitsSchema) {}
export type UpdateCardLimitsInput = z.infer<typeof UpdateCardLimitsSchema>;

export class CardDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({
    example: '4258123456781234',
    required: false,
    description: 'Полный номер карты; возвращается только владельцу карты',
  })
  cardNumber?: string;

  @ApiProperty({ example: '4258 •••• •••• 1234' })
  cardNumberMask: string;

  @ApiProperty({ example: 'ИВАН ДРЁМИН' })
  cardholderName: string;

  @ApiProperty({ example: '10/29' })
  expiryDate: string;

  @ApiProperty({ example: 'VIRTUAL' })
  type: string;

  @ApiProperty({ example: 100.0 })
  balance: number;

  @ApiProperty({ example: false })
  isBlocked: boolean;

  @ApiProperty({ example: 25.0 })
  dailyLimit: number;

  @ApiProperty({ example: 0.0 })
  spentToday: number;

  @ApiProperty({ example: true })
  allowOnlinePurchases: boolean;

  @ApiProperty({ example: false })
  allowCashWithdrawal: boolean;

  @ApiProperty({ example: 25.0 })
  remainingDailyLimit: number;

  @ApiProperty({ example: 25.0, description: 'Сумма карманных в неделю' })
  pocketMoneyAmount: number;

  @ApiProperty({ example: 1, description: 'День недели выплаты (1 — понедельник, 7 — воскресенье)' })
  pocketMoneyDay: number;
}

export class CardTransactionDto {
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

export class CardDetailsDto extends CardDto {
  @ApiProperty({ type: [CardTransactionDto], required: false })
  transactions?: CardTransactionDto[];
}

export class ChildUserWithCardsDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 'Иван' })
  name: string;

  @ApiProperty({ example: '+375291234567' })
  phoneNumber: string;

  @ApiProperty({ example: '2012-05-10T00:00:00.000Z' })
  birthDay: Date;

  @ApiProperty({ example: 'CHILD_7_13' })
  role: string;

  @ApiProperty({ example: 120, description: 'Бонусный баланс Мобиков' })
  mobiksBalance: number;

  @ApiProperty({ type: [CardDto] })
  cards: CardDto[];
}

export class AddChildResponseDto {
  @ApiProperty({ example: 'Ребенок успешно зарегистрирован и привязан к семье' })
  message: string;

  @ApiProperty({ example: 'PARENT' })
  parentRole: string;

  @ApiProperty({ type: ChildUserWithCardsDto })
  child: ChildUserWithCardsDto;
}

export class LinkChildSummaryDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 'Иван' })
  name: string;

  @ApiProperty({ example: '+375291234567' })
  phoneNumber: string;

  @ApiProperty({ example: '2012-05-10T00:00:00.000Z' })
  birthDay: Date;

  @ApiProperty({ example: 'CHILD_7_13' })
  role: string;
}

export class LinkChildResponseDto {
  @ApiProperty({ example: 'Член семьи успешно привязан' })
  message: string;

  @ApiProperty({ example: 'PARENT' })
  parentRole: string;

  @ApiProperty({ type: LinkChildSummaryDto })
  child: LinkChildSummaryDto;

  @ApiProperty({ required: false, nullable: true })
  passportVerification?: any;
}

export class ParentSummaryDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 'Андрей Дрёмин' })
  name: string;

  @ApiProperty({ example: '+375291112233' })
  phoneNumber: string;

  @ApiProperty({ example: 'PARENT' })
  role: string;
}

export class FamilyMemberUserDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 'Иван' })
  name: string;

  @ApiProperty({ example: '+375291234567' })
  phoneNumber: string;

  @ApiProperty({ example: '2012-05-10T00:00:00.000Z' })
  birthDay: Date;

  @ApiProperty({ example: 'CHILD_7_13' })
  role: string;

  @ApiProperty({ example: 120, description: 'Бонусный баланс Мобиков' })
  mobiksBalance: number;

  @ApiProperty({ type: [ParentSummaryDto] })
  parents: ParentSummaryDto[];

  @ApiProperty({ type: [CardDto] })
  cards: CardDto[];
}

export class FamilyResponseDto {
  @ApiProperty({ type: FamilyMemberUserDto })
  user: FamilyMemberUserDto;

  @ApiProperty({ type: [ChildUserWithCardsDto] })
  children: ChildUserWithCardsDto[];
}

export class DeleteFamilyMemberResponseDto {
  @ApiProperty({ example: 'Ребенок успешно удален из семьи' })
  message: string;

  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821', required: false })
  childId?: string;

  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821', required: false })
  parentId?: string;
}

export class CardLimitsDetailsDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: '4258 •••• •••• 1234' })
  cardNumberMask: string;

  @ApiProperty({ example: 'ИВАН ДРЁМИН' })
  cardholderName: string;

  @ApiProperty({ example: 'Иван' })
  childName: string;

  @ApiProperty({ example: 'VIRTUAL' })
  type: string;

  @ApiProperty({ example: 45.0 })
  balance: number;

  @ApiProperty({ example: 25.0 })
  dailyLimit: number;

  @ApiProperty({ example: 10.0 })
  spentToday: number;

  @ApiProperty({ example: 15.0 })
  remainingDailyLimit: number;

  @ApiProperty({ example: true })
  allowOnlinePurchases: boolean;

  @ApiProperty({ example: false })
  allowCashWithdrawal: boolean;

  @ApiProperty({ example: false })
  isBlocked: boolean;

  @ApiProperty({ example: 25.0, description: 'Сумма карманных в неделю' })
  pocketMoneyAmount: number;

  @ApiProperty({ example: 1, description: 'День недели выплаты (1 — понедельник, 7 — воскресенье)' })
  pocketMoneyDay: number;
}

export class UpdateCardLimitsResponseDto {
  @ApiProperty({ example: 'Лимит для карты ребенка Иван успешно обновлен' })
  message: string;

  @ApiProperty({ type: CardLimitsDetailsDto })
  card: CardLimitsDetailsDto;
}

export class ResetSpentTodayDetailsDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: '4258 •••• •••• 1234' })
  cardNumberMask: string;

  @ApiProperty({ example: 25.0 })
  dailyLimit: number;

  @ApiProperty({ example: 0.0 })
  spentToday: number;

  @ApiProperty({ example: 25.0 })
  remainingDailyLimit: number;
}

export class ResetSpentTodayResponseDto {
  @ApiProperty({ example: 'Потраченная сумма за сегодня для карты Иван сброшена' })
  message: string;

  @ApiProperty({ type: ResetSpentTodayDetailsDto })
  card: ResetSpentTodayDetailsDto;
}

export class GraduationCheckpointDto {
  @ApiProperty({ example: 'Опыт накоплений' })
  title: string;

  @ApiProperty({ example: 'Успешно закрыта хотя бы одна копилка' })
  description: string;

  @ApiProperty({ example: true })
  isCompleted: boolean;
}

export class GraduationStatusResponseDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  userId: string;

  @ApiProperty({ example: 'Иван Дрёмин' })
  userName: string;

  @ApiProperty({ example: 'TEEN_14_17' })
  currentRole: string;

  @ApiProperty({ example: 17.5 })
  age: number;

  @ApiProperty({ example: 85, description: 'Процент готовности к самостоятельному банкингу (0-100%)' })
  progressPercentage: number;

  @ApiProperty({ example: true, description: 'Доступна ли кнопка выпуска во взрослый банкинг' })
  isEligibleForGraduation: boolean;

  @ApiProperty({ example: 2, description: 'Количество успешно накопленных и закрытых копилок' })
  completedPiggyBanksCount: number;

  @ApiProperty({ example: 5, description: 'Количество выполненных заданий от родителей' })
  completedTasksCount: number;

  @ApiProperty({ example: 120, description: 'Баланс бонусов Мобиков' })
  mobiksBalance: number;

  @ApiProperty({ example: 14, description: 'Количество совершенных покупок' })
  transactionsCount: number;

  @ApiProperty({ type: [GraduationCheckpointDto] })
  checkpoints: GraduationCheckpointDto[];
}

export class GraduateResponseDto {
  @ApiProperty({ example: 'Поздравляем с переходом во взрослый банкинг! Все детские ограничения и родительский контроль сняты.' })
  message: string;

  @ApiProperty({ example: 'ORDINARY' })
  newRole: string;

  @ApiProperty({ type: [CardDto] })
  cards: CardDto[];
}

