import { Module } from '@nestjs/common';
import { PiggyBanksController } from './piggy-banks.controller';
import { PiggyBanksService } from './piggy-banks.service';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [PrismaModule, JwtModule],
  controllers: [PiggyBanksController],
  providers: [PiggyBanksService],
  exports: [PiggyBanksService],
})
export class PiggyBanksModule {}
