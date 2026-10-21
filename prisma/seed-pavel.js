/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv').config();

const bcrypt = require('bcrypt');
const { PrismaClient } = require('../generated/prisma/client.js');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter });

const PARENT_PHONE = '+375257806031';
const CHILD_PHONE = '+375291234567';
const CHILD_PASSWORD = 'pavel12345';

const daysAgo = (days, hours = 12) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hours, 0, 0, 0);
  return date;
};

async function main() {
  const parent = await prisma.user.findUnique({
    where: { phoneNumber: PARENT_PHONE },
    include: { cards: true },
  });

  if (!parent) {
    throw new Error(`Родитель ${PARENT_PHONE} не найден`);
  }

  const password = await bcrypt.hash(CHILD_PASSWORD, 10);

  const child = await prisma.user.upsert({
    where: { phoneNumber: CHILD_PHONE },
    update: {},
    create: {
      name: 'Петров Павел Олегович',
      phoneNumber: CHILD_PHONE,
      birthDay: new Date('2014-03-12T00:00:00.000Z'),
      password,
      role: 'CHILD_7_13',
    },
  });

  await prisma.familyRelation.upsert({
    where: {
      parentId_childId: { parentId: parent.id, childId: child.id },
    },
    update: {},
    create: { parentId: parent.id, childId: child.id },
  });

  const existingCard = await prisma.card.findFirst({
    where: { userId: child.id },
    orderBy: { id: 'asc' },
  });

  const card = existingCard
    ? existingCard
    : await prisma.card.create({
        data: {
          cardNumberMask: '4258 •••• •••• 1548',
          cardholderName: 'ПЕТРОВ ПАВЕЛ ОЛЕГОВИЧ',
          expiryDate: '10/29',
          type: 'VIRTUAL',
          balance: 42,
          isBlocked: false,
          dailyLimit: 15,
          spentToday: 0,
          allowOnlinePurchases: true,
          allowCashWithdrawal: true,
          userId: child.id,
        },
      });

  const existingGoal = await prisma.piggyBank.findFirst({
    where: { ownerId: child.id, title: 'Новый телефон' },
  });
  const goal = existingGoal
    ? await prisma.piggyBank.update({
        where: { id: existingGoal.id },
        data: {
          description: 'Коплю на новый смартфон',
          targetAmount: 600,
          currentAmount: 180,
          targetDate: new Date('2027-03-01T00:00:00.000Z'),
          status: 'ACTIVE',
        },
      })
    : await prisma.piggyBank.create({
        data: {
          ownerId: child.id,
          title: 'Новый телефон',
          description: 'Коплю на новый смартфон',
          targetAmount: 600,
          currentAmount: 180,
          targetDate: new Date('2027-03-01T00:00:00.000Z'),
          status: 'ACTIVE',
        },
      });

  await prisma.piggyBankContribution.deleteMany({ where: { piggyBankId: goal.id } });
  await prisma.piggyBankContribution.createMany({
    data: [
      {
        piggyBankId: goal.id,
        userId: child.id,
        cardId: card.id,
        amount: 100,
        comment: 'С карманных',
        createdAt: daysAgo(20),
      },
      {
        piggyBankId: goal.id,
        userId: parent.id,
        cardId: parent.cards[0]?.id,
        amount: 65,
        comment: 'На день рождения',
        createdAt: daysAgo(12),
      },
      {
        piggyBankId: goal.id,
        userId: child.id,
        cardId: card.id,
        amount: 15,
        comment: 'Сэкономил на обедах',
        createdAt: daysAgo(2),
      },
    ],
  });

  console.log('Pavel ready', { childId: child.id, parentId: parent.id, cardId: card.id, goalId: goal.id });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
