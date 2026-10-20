import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('system')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Healthcheck / Приветствие' })
  @ApiResponse({ status: 200, description: 'Успешный ответ сервиса', type: String })
  getHello(): string {
    return this.appService.getHello();
  }
}
