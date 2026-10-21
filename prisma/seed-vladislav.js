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
const CHILD_PHONE = '+375291234568';
const CHILD_PASSWORD = 'vlad12345';

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
    update: {
      name: 'Петров Владислав Олегович',
      birthDay: new Date('2009-12-05T00:00:00.000Z'),
      role: 'TEEN_14_17',
      mobiksBalance: 368,
      selectedCashbackCategories: ['FOOD', 'EDUCATION'],
    },
    create: {
      name: 'Петров Владислав Олегович',
      phoneNumber: CHILD_PHONE,
      birthDay: new Date('2009-12-05T00:00:00.000Z'),
      password,
      role: 'TEEN_14_17',
      mobiksBalance: 368,
      selectedCashbackCategories: ['FOOD', 'EDUCATION'],
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

  const cardData = {
    cardNumberMask: '4258 •••• •••• 5824',
    cardholderName: 'ПЕТРОВ ВЛАДИСЛАВ ОЛЕГОВИЧ',
    expiryDate: '10/29',
    type: 'VIRTUAL',
    balance: 142.5,
    isBlocked: false,
    dailyLimit: 30,
    spentToday: 14.2,
    allowOnlinePurchases: true,
    allowCashWithdrawal: false,
  };

  const card = existingCard
    ? await prisma.card.update({ where: { id: existingCard.id }, data: cardData })
    : await prisma.card.create({ data: { ...cardData, userId: child.id } });

  await prisma.transaction.deleteMany({
    where: {
      userId: child.id,
      merchant: {
        in: [
          'Додо Пицца',
          'Перевод от Олега Ивановича',
          'Wildberries',
          'Минсктранс (Метро)',
          'KFC',
        ],
      },
    },
  });

  await prisma.transaction.createMany({
    data: [
      {
        userId: child.id,
        cardId: card.id,
        amount: 14.2,
        merchant: 'Додо Пицца',
        category: 'FOOD',
        status: 'SUCCESS',
        createdAt: daysAgo(0, 15),
      },
      {
        userId: child.id,
        cardId: card.id,
        amount: 50,
        merchant: 'Перевод от Олега Ивановича',
        category: 'TRANSFER',
        status: 'SUCCESS',
        createdAt: daysAgo(0, 12),
      },
      {
        userId: child.id,
        cardId: card.id,
        amount: 32.5,
        merchant: 'Wildberries',
        category: 'SHOPPING',
        status: 'SUCCESS',
        createdAt: daysAgo(1, 19),
      },
      {
        userId: child.id,
        cardId: card.id,
        amount: 0.9,
        merchant: 'Минсктранс (Метро)',
        category: 'TRANSPORT',
        status: 'SUCCESS',
        createdAt: daysAgo(1, 8),
      },
    ],
  });

  const activeGoal = await prisma.piggyBank.findFirst({
    where: { ownerId: child.id, title: 'Новый ноутбук' },
  });
  const goal = activeGoal
    ? await prisma.piggyBank.update({
        where: { id: activeGoal.id },
        data: {
          description: 'Коплю на учёбу и дизайн',
          targetAmount: 1000,
          currentAmount: 680,
          targetDate: new Date('2027-03-01T00:00:00.000Z'),
          status: 'ACTIVE',
        },
      })
    : await prisma.piggyBank.create({
        data: {
          ownerId: child.id,
          title: 'Новый ноутбук',
          description: 'Коплю на учёбу и дизайн',
          targetAmount: 1000,
          currentAmount: 680,
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
        amount: 80,
        comment: 'С карманных',
        createdAt: daysAgo(20),
      },
      {
        piggyBankId: goal.id,
        userId: parent.id,
        cardId: parent.cards[0]?.id,
        amount: 500,
        comment: 'На день рождения',
        createdAt: daysAgo(12),
      },
      {
        piggyBankId: goal.id,
        userId: child.id,
        cardId: card.id,
        amount: 100,
        comment: 'Сэкономил на обедах',
        createdAt: daysAgo(3),
      },
    ],
  });

  const completedGoal = await prisma.piggyBank.findFirst({
    where: { ownerId: child.id, title: 'Наушники' },
  });
  if (!completedGoal) {
    await prisma.piggyBank.create({
      data: {
        ownerId: child.id,
        title: 'Наушники',
        description: 'Первая закрытая цель',
        targetAmount: 150,
        currentAmount: 150,
        status: 'COMPLETED',
      },
    });
  }

  const completedTaskTitles = ['Помыть посуду', 'Погулять с собакой', 'Собрать рюкзак'];
  for (const [index, title] of completedTaskTitles.entries()) {
    const existing = await prisma.task.findFirst({
      where: { creatorId: parent.id, assignedChildId: child.id, title },
    });
    if (!existing) {
      await prisma.task.create({
        data: {
          title,
          description: 'Задание из семейного списка',
          rewardAmount: index === 1 ? 15 : 10,
          status: 'COMPLETED',
          creatorId: parent.id,
          creatorCardId: parent.cards[0]?.id,
          assignedChildId: child.id,
          completedById: child.id,
          targetCardId: card.id,
          submittedAt: daysAgo(index + 4),
        },
      });
    }
  }

  console.log('Vladislav ready', { childId: child.id, parentId: parent.id, cardId: card.id });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
