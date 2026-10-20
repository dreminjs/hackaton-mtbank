import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';
import { PrismaClient } from '#generated/prisma';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString =
      process.env.DATABASE_URL ||
      'postgresql://neondb_owner:npg_cG5kUqu9dSyv@ep-solitary-fog-b95pbiol-pooler.c-7.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

    const adapter = new PrismaPg({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    super({ adapter });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Prisma connected to PostgreSQL successfully');
    } catch (err) {
      this.logger.error('Failed to connect to database during init', err);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
