import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaymentsService } from './payments.service';
import { PayQrDto } from './payments.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('qr')
  async payByQr(@Req() req: any, @Body() dto: PayQrDto) {
    const userId = req.user.id || req.user.sub;
    return this.paymentsService.payByQr(userId, dto);
  }
}
