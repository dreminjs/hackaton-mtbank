import {
  Controller,
  Get,
  Param,
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
import { UsersService } from './users.service';
import { CardDetailsDto, CardDto } from './users.dto';

@ApiTags('cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cards')
export class CardsController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'Получить список собственных карт (для ребенка или родителя)',
    description:
      'Возвращает все банковские карты текущего пользователя с балансом, суточными лимитами, потраченной суммой за день и остатком. Если у пользователя еще не было карт, автоматически создается виртуальная карта.',
  })
  @ApiResponse({
    status: 200,
    description: 'Список собственных карт',
    type: [CardDto],
  })
  async getMyCards(@Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.usersService.getMyCards(userId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Получить детальную информацию по карте (с историей транзакций)',
    description:
      'Возвращает подробные данные карты и список последних транзакций. Доступно владельцу карты или родителю ребенка.',
  })
  @ApiParam({ name: 'id', description: 'ID карты' })
  @ApiResponse({
    status: 200,
    description: 'Детали карты и последние транзакции',
    type: CardDetailsDto,
  })
  async getCardById(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.id || req.user.sub;
    return this.usersService.getCardById(userId, id);
  }
}
