import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { ApiProperty } from '@nestjs/swagger';

// Выбор категорий повышенного кэшбэка
export const SelectCashbackCategoriesSchema = z.object({
  categories: z
    .array(z.string().min(1))
    .min(1, 'Выберите хотя бы одну категорию')
    .max(2, 'Можно выбрать максимум 2 категории повышенного кэшбэка'),
});

export class SelectCashbackCategoriesDto extends createZodDto(SelectCashbackCategoriesSchema) {}
export type TSelectCashbackCategoriesDto = z.infer<typeof SelectCashbackCategoriesSchema>;

// --- Swagger Response Models ---

export class PartnerOfferDto {
  @ApiProperty({ example: 'dodo-pizza-promo' })
  id: string;

  @ApiProperty({ example: 'Пепперони 25 см в подарок' })
  title: string;

  @ApiProperty({ example: 'Промокод на бесплатную сочную пиццу при заказе от 20 BYN в Додо Пицца.' })
  description: string;

  @ApiProperty({ example: 'Додо Пицца' })
  partnerName: string;

  @ApiProperty({ example: 50, description: 'Стоимость в Мобиках' })
  cost: number;

  @ApiProperty({ example: 'FOOD' })
  category: string;

  @ApiProperty({ example: 'https://images.unsplash.com/photo-1534308983496-4fabb1a015ee?w=500' })
  imageUrl: string;

  @ApiProperty({ example: 'Бесплатно', required: false })
  discountBadge?: string;
}

export class PurchasedRewardDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 'dodo-pizza-promo' })
  offerId: string;

  @ApiProperty({ example: 'Пепперони 25 см в подарок' })
  title: string;

  @ApiProperty({ example: 'Додо Пицца' })
  partnerName: string;

  @ApiProperty({ example: 50 })
  cost: number;

  @ApiProperty({ example: 'MOBY-DODO-8291' })
  promoCode: string;

  @ApiProperty({ example: '2026-10-21T03:30:00.000Z' })
  createdAt: Date;
}

export class LoyaltyOffersResponseDto {
  @ApiProperty({ example: 120, description: 'Текущий баланс Мобиков пользователя' })
  mobiksBalance: number;

  @ApiProperty({ type: [PartnerOfferDto], description: 'Доступные для покупки акции партнеров' })
  offers: PartnerOfferDto[];

  @ApiProperty({ type: [PurchasedRewardDto], description: 'Уже купленные промокоды и сертификаты' })
  purchasedRewards: PurchasedRewardDto[];
}

export class RedeemOfferResponseDto {
  @ApiProperty({ example: 'Сертификат «Пепперони 25 см в подарок» успешно куплен за 50 Мобиков!' })
  message: string;

  @ApiProperty({ example: 70, description: 'Остаток баланса Мобиков' })
  mobiksBalance: number;

  @ApiProperty({ example: 50, description: 'Списано Мобиков' })
  spentMobiks: number;

  @ApiProperty({ type: PurchasedRewardDto })
  purchasedReward: PurchasedRewardDto;
}

export class CashbackCategoryOptionDto {
  @ApiProperty({ example: 'FOOD' })
  code: string;

  @ApiProperty({ example: 'Кафе и фастфуд' })
  name: string;

  @ApiProperty({ example: 'Пиццерии, бургерные, школьные столовые и кофейни' })
  description: string;

  @ApiProperty({ example: '🍔' })
  icon: string;

  @ApiProperty({ example: 2, description: 'Множитель начисления Мобиков (x2)' })
  multiplier: number;
}

export class CashbackCategoriesResponseDto {
  @ApiProperty({ example: ['FOOD', 'EDUCATION'], description: 'Выбранные пользователем категории повышенного кэшбэка' })
  selectedCategories: string[];

  @ApiProperty({ type: [CashbackCategoryOptionDto], description: 'Все доступные для выбора категории' })
  availableCategories: CashbackCategoryOptionDto[];
}

export class SelectCashbackCategoriesResponseDto {
  @ApiProperty({ example: 'Категории повышенного кэшбэка на месяц успешно сохранены!' })
  message: string;

  @ApiProperty({ example: ['FOOD', 'EDUCATION'] })
  selectedCategories: string[];
}
