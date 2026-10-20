import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { PiggyBanksService } from './piggy-banks.service';
import {
  CreatePiggyBankDto,
  CreatePiggyBankResponseDto,
  PiggyBankResponseDto,
  TopUpPiggyBankDto,
  TopUpPiggyBankResponseDto,
  UpdatePiggyBankDto,
  WithdrawPiggyBankDto,
  WithdrawPiggyBankResponseDto,
} from './piggy-banks.dto';

@ApiTags('piggy-banks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('piggy-banks')
export class PiggyBanksController {
  constructor(private readonly piggyBanksService: PiggyBanksService) {}

  @Post()
  @ApiOperation({
    summary: 'Создать копилку / цель накопления (только для ребенка)',
    description:
      'Ребенок открывает копилку на свою мечту (PlayStation, велосипед, кроссовки). Указывает целевую сумму и дату. Можно сразу внести стартовый взнос из карманных денег. Родители создать себе копилку не могут.',
  })
  @ApiResponse({
    status: 201,
    description: 'Копилка успешно открыта',
    type: CreatePiggyBankResponseDto,
  })
  async createPiggyBank(@Req() req: any, @Body() dto: CreatePiggyBankDto) {
    const userId = req.user.id || req.user.sub;
    return this.piggyBanksService.createPiggyBank(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Получить список копилок (для ребенка или родителя)',
    description:
      'Если авторизован ребенок — возвращаются его личные копилки с прогрессом накопления. Если авторизован родитель — возвращаются копилки всех детей его семьи, чтобы родители могли видеть цели и пополнять их.',
  })
  @ApiResponse({
    status: 200,
    description: 'Список копилок с прогрессом накопления',
    type: [PiggyBankResponseDto],
  })
  async getPiggyBanks(@Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.piggyBanksService.getPiggyBanks(userId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Детальная информация о копилке (с историей пополнений от семьи)',
    description:
      'Возвращает подробности цели, процент прогресса, оставшуюся сумму и историю пополнений (кто из родственников сколько внес и с каким пожеланием).',
  })
  @ApiParam({ name: 'id', description: 'ID копилки' })
  @ApiResponse({
    status: 200,
    description: 'Детальные данные копилки',
    type: PiggyBankResponseDto,
  })
  async getPiggyBankById(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.id || req.user.sub;
    return this.piggyBanksService.getPiggyBankById(userId, id);
  }

  @Post(':id/top-up')
  @ApiOperation({
    summary: 'Пополнить копилку ребенка (ребенок с карманных денег или любой член семьи)',
    description:
      'Позволяет внести деньги в копилку. Пополнить может сам ребенок со своей карты или любой член семьи (папа, мама, брат, сестра). Деньги списываются с банковской карты отправителя и пополняют баланс копилки.',
  })
  @ApiParam({ name: 'id', description: 'ID копилки' })
  @ApiResponse({
    status: 200,
    description: 'Копилка успешно пополнена',
    type: TopUpPiggyBankResponseDto,
  })
  async topUpPiggyBank(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: TopUpPiggyBankDto,
  ) {
    const senderUserId = req.user.id || req.user.sub;
    return this.piggyBanksService.topUpPiggyBank(senderUserId, id, dto);
  }

  @Post(':id/withdraw')
  @ApiOperation({
    summary: 'Снять средства из копилки на банковскую карту / разбить копилку (для ребенка)',
    description:
      'Ребенок забирает накопленные средства. Вся накопленная сумма перечисляется на банковскую карту ребенка. Статус копилки переходит в COMPLETED (если цель достигнута) или BROKEN (досрочно разбита).',
  })
  @ApiParam({ name: 'id', description: 'ID копилки' })
  @ApiResponse({
    status: 200,
    description: 'Средства из копилки успешно выведены на карту',
    type: WithdrawPiggyBankResponseDto,
  })
  async withdrawPiggyBank(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: WithdrawPiggyBankDto,
  ) {
    const childUserId = req.user.id || req.user.sub;
    return this.piggyBanksService.withdrawPiggyBank(childUserId, id, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Редактировать параметры копилки (для ребенка-владельца)',
    description:
      'Ребенок может изменить название своей цели, описание, целевую сумму или желаемую дату достижения.',
  })
  @ApiParam({ name: 'id', description: 'ID копилки' })
  @ApiResponse({
    status: 200,
    description: 'Параметры копилки обновлены',
    type: PiggyBankResponseDto,
  })
  async updatePiggyBank(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdatePiggyBankDto,
  ) {
    const childUserId = req.user.id || req.user.sub;
    return this.piggyBanksService.updatePiggyBank(childUserId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Удалить копилку (с возвратом оставшихся средств на карту ребенка)',
    description:
      'Ребенок удаляет копилку. Если в ней оставались накопления, они автоматически зачисляются обратно на банковскую карту ребенка.',
  })
  @ApiParam({ name: 'id', description: 'ID копилки' })
  @ApiResponse({
    status: 200,
    description: 'Копилка удалена, средства возвращены',
  })
  async deletePiggyBank(@Req() req: any, @Param('id') id: string) {
    const childUserId = req.user.id || req.user.sub;
    return this.piggyBanksService.deletePiggyBank(childUserId, id);
  }
}
