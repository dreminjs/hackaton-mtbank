import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { CardsController } from './cards.controller';
import { UsersService } from './users.service';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';

import { PassportModule } from '../passport/passport.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PrismaModule, JwtModule, PassportModule, PaymentsModule],
  controllers: [UsersController, CardsController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
