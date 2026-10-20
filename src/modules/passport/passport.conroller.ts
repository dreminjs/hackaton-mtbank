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
  ApiTags,
  ApiProperty,
} from '@nestjs/swagger';

export class PassportRecognizeResponseDto {
  @ApiProperty({ example: 'DREMIN', required: false })
  lastName?: string;

  @ApiProperty({ example: 'ANDREW', required: false })
  firstName?: string;

  @ApiProperty({ example: 'SERGEEVICH', required: false })
  middleName?: string;

  @ApiProperty({ example: 'MC1234567', required: false })
  documentNumber?: string;

  @ApiProperty({ example: '3010190A001PB1', required: false })
  personalNumber?: string;

  @ApiProperty({ example: '23.07.2008', required: false })
  birthDate?: string;

  @ApiProperty({ example: '23.07.2028', required: false })
  expiryDate?: string;
}

@ApiTags('passport')
@Controller()
export class PassportController {
  constructor(private readonly passportService: PassportService) {}

  @Post('passport')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Распознавание паспорта по фото через OCR' })
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
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Данные паспорта успешно распознаны',
    type: PassportRecognizeResponseDto,
  })
  recognize(@UploadedFile() file: Express.Multer.File) {
    return this.passportService.recognize(file);
  }
}
