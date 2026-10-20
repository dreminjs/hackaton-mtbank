import {
  Post,
  UseInterceptors,
  UploadedFile,
  Controller,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PassportService } from './passport.service';
import {
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
@Controller()
export class PassportController {
  constructor(private readonly passportService: PassportService) {}
  @Post('passport')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Распознавание паспорта по фото' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Файл изображения паспорта',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Паспорт успешно распознан' })
  recognize(@UploadedFile() file: Express.Multer.File) {
    return this.passportService.recognize(file);
  }
}
