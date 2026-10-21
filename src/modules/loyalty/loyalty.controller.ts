import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LoyaltyService } from './loyalty.service';
import {
  CashbackCategoriesResponseDto,
  LoyaltyOffersResponseDto,
  RedeemOfferResponseDto,
  SelectCashbackCategoriesDto,
  SelectCashbackCategoriesResponseDto,
} from './loyalty.dto';

@ApiTags('loyalty (Мобики и партнеры)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Get('offers')
  @ApiOperation({
    summary: 'Получить витрину акций партнеров, баланс Мобиков и купленные купоны',
    description:
      'Возвращает текущий баланс Мобиков пользователя, каталог партнерских скидок и сертификатов (Додо Пицца, Яндекс Плюс, Silver Screen и др.), а также историю полученных промокодов.',
  })
  @ApiResponse({
    status: 200,
    description: 'Витрина акций и история наград',
    type: LoyaltyOffersResponseDto,
  })
  async getOffers(@Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.loyaltyService.getOffers(userId);
  }

  @Post('offers/:offerId/redeem')
  @ApiOperation({
    summary: 'Купить акцию / промокод партнера за Мобики',
    description:
      'Списывает стоимость акции в Мобиках с бонусного баланса пользователя, генерирует уникальный промокод и сохраняет в личные награды.',
  })
  @ApiParam({ name: 'offerId', description: 'ID акции партнера (например dodo-pizza-promo)' })
  @ApiResponse({
    status: 200,
    description: 'Акция успешно приобретена за Мобики',
    type: RedeemOfferResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Недостаточно Мобиков на балансе' })
  @ApiResponse({ status: 404, description: 'Акция не найдена' })
  async redeemOffer(@Req() req: any, @Param('offerId') offerId: string) {
    const userId = req.user.id || req.user.sub;
    return this.loyaltyService.redeemOffer(userId, offerId);
  }

  @Get('cashback/categories')
  @ApiOperation({
    summary: 'Получить доступные категории повышенного кэшбэка и текущий выбор',
    description:
      'Возвращает категории для выбора (Кафе, Книги, Игры, Транспорт, Маркетплейсы) с множителем x2 Мобиков и уже выбранные пользователем категории.',
  })
  @ApiResponse({
    status: 200,
    description: 'Список категорий кэшбэка',
    type: CashbackCategoriesResponseDto,
  })
  async getCashbackCategories(@Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.loyaltyService.getCashbackCategories(userId);
  }

  @Post('cashback/select')
  @ApiOperation({
    summary: 'Выбрать категории повышенного кэшбэка на месяц (до 2 категорий)',
    description:
      'Сохраняет выбранные категории (максимум 2). При покупках в этих категориях пользователь будет получать x2 Мобиков за каждый потраченный рубль.',
  })
  @ApiResponse({
    status: 200,
    description: 'Категории повышенного кэшбэка успешно выбраны',
    type: SelectCashbackCategoriesResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Выбрано более 2 категорий или недопустимый код' })
  async selectCashbackCategories(
    @Req() req: any,
    @Body() dto: SelectCashbackCategoriesDto,
  ) {
    const userId = req.user.id || req.user.sub;
    return this.loyaltyService.selectCashbackCategories(userId, dto);
  }
}
