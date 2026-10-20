import { Module } from '@nestjs/common';
import { PassportController } from './passport.conroller';
import { PassportService } from './passport.service';

@Module({
  controllers: [PassportController],
  providers: [PassportService]
})
export class PassportModule {}
