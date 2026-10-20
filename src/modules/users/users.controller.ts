import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { AddChildDto, LinkChildDto } from './users.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('users / family')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('family/children')
  @ApiOperation({
    summary: 'Регистрация и добавление нового ребенка в семью',
    description:
      'Создает аккаунт ребенка, выпускает виртуальную карту, назначает роль CHILD_7_13 или TEEN_14_17 в зависимости от возраста, а родителю выставляет роль PARENT.',
  })
  @ApiResponse({ status: 201, description: 'Ребенок успешно зарегистрирован' })
  async addChild(@Req() req: any, @Body() dto: AddChildDto) {
    const parentId = req.user.id || req.user.sub;
    return this.usersService.addChild(parentId, dto);
  }

  @Post('family/link')
  @UseInterceptors(FileInterceptor('passport'))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({
    summary: 'Привязка существующего аккаунта ребенка по номеру телефона (со сканом паспорта)',
    description:
      'Ищет ребенка по номеру телефона, распознает скан паспорта через OCR Tesseract, сравнивает имена из паспорта и профиля пользователя. При совпадении привязывает ребенка и выставляет соответствующие роли.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        phoneNumber: { type: 'string', example: '+375291234567' },
        passport: {
          type: 'string',
          format: 'binary',
          description: 'Фото/скан разворота паспорта ребенка',
        },
      },
      required: ['phoneNumber'],
    },
  })
  @ApiResponse({ status: 200, description: 'Ребенок успешно привязан после проверки паспорта' })
  @ApiResponse({ status: 400, description: 'Несовпадение имени в паспорте или невалидные данные' })
  async linkChild(
    @Req() req: any,
    @Body() dto: LinkChildDto,
    @UploadedFile() passportFile?: Express.Multer.File,
  ) {
    const parentId = req.user.id || req.user.sub;
    return this.usersService.linkChild(parentId, dto, passportFile);
  }

  @Get('family')
  @ApiOperation({
    summary: 'Получить информацию о семье (родитель, дети и их карты)',
  })
  @ApiResponse({ status: 200, description: 'Информация о семье получена' })
  async getFamily(@Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.usersService.getFamily(userId);
  }
}
