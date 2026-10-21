import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PassportModule } from '../passport/passport.module';
import { PaymentsModule } from '../payments/payments.module';

import { UsersModule } from '../users/users.module';
import { TasksModule } from '../tasks/tasks.module';
import { PiggyBanksModule } from '../piggy-banks/piggy-banks.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PassportModule,
    PaymentsModule,
    UsersModule,
    TasksModule,
    PiggyBanksModule,
    NotificationsModule,
    LoyaltyModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
  ],
})
export class AppModule { }
