import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginInput, RegisterInput } from './auth.dto';
import { PrismaService } from '../prisma/prisma.service';
import { User, UserRole } from '#generated/prisma/client';
import * as bcrypt from 'bcrypt';
import { generateCardNumber, toCardNumberMask } from '../../common/card-number.helper';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) { }

  async register(dto: RegisterInput) {
    const existing = await this.prisma.user.findUnique({
      where: { phoneNumber: dto.phoneNumber },
    });
    if (existing) {
      throw new BadRequestException(
        'Пользователь с таким номером телефона уже существует',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const cardNumber = generateCardNumber();

    const user: User = await this.prisma.user.create({
      data: {
        phoneNumber: dto.phoneNumber,
        password: passwordHash,
        name: dto.name,
        birthDay: new Date(dto.birthDay),
        role: UserRole.ORDINARY,
        cards: {
          create: {
            cardNumber,
            cardNumberMask: toCardNumberMask(cardNumber),
            cardholderName: dto.name.toUpperCase(),
            expiryDate: '10/29',
            type: 'VIRTUAL',
            balance: 500.0,
            dailyLimit: 200.0,
            spentToday: 0.0,
            allowOnlinePurchases: true,
            allowCashWithdrawal: true,
          },
        },
      },
    });

    const tokens = await this.generateTokens(user.id, user.phoneNumber);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return {
      user: { id: user.id, phoneNumber: user.phoneNumber, name: user.name },
      ...tokens,
    };
  }

  async login(dto: LoginInput) {
    const user = await this.prisma.user.findUnique({
      where: { phoneNumber: dto.phoneNumber },
    });
    if (!user) {
      throw new UnauthorizedException('Неверный номер телефона или пароль');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Неверный номер телефона или пароль');
    }

    const tokens = await this.generateTokens(user.id, user.phoneNumber);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return {
      user: { id: user.id, phoneNumber: user.phoneNumber, name: user.name },
      ...tokens,
    };
  }

  async refreshTokens(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET || 'hackaton-refresh-secret',
      });
    } catch {
      throw new ForbiddenException('Невалидный refresh-токен');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.hashedRefreshToken) {
      throw new ForbiddenException('Доступ запрещен');
    }

    const isRefreshValid = await bcrypt.compare(
      refreshToken,
      user.hashedRefreshToken,
    );
    if (!isRefreshValid) {
      throw new ForbiddenException('Доступ запрещен');
    }

    const tokens = await this.generateTokens(user.id, user.phoneNumber);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return tokens;
  }

  async logout(userId: string) {
    await this.prisma.user.updateMany({
      where: { id: userId, hashedRefreshToken: { not: null } },
      data: { hashedRefreshToken: null },
    });
    return { success: true };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phoneNumber: true,
        name: true,
        birthDay: true,
        role: true,
        mobiksBalance: true,
        selectedCashbackCategories: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    return user;
  }

  private async updateRefreshToken(userId: string, refreshToken: string) {
    const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { hashedRefreshToken },
    });
  }

  private async generateTokens(userId: string, phoneNumber: string) {
    const payload = { sub: userId, phoneNumber };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_ACCESS_SECRET || 'hackaton-access-secret',
        expiresIn: '15m',
      }),
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_REFRESH_SECRET || 'hackaton-refresh-secret',
        expiresIn: '30d',
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
