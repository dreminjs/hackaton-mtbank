export interface MccRule {
  category: string;
  label: string;
  cashbackPercent: number;
  isRestricted18Plus: boolean;
}

export const MCC_DIRECTORY: Record<string, MccRule> = {
  // --- ЕДА И СУПЕРМАРКЕТЫ ---
  '5812': {
    category: 'FOOD',
    label: 'Кафе и рестораны',
    cashbackPercent: 3,
    isRestricted18Plus: false,
  },
  '5814': {
    category: 'FOOD',
    label: 'Фастфуд и школьные столовые',
    cashbackPercent: 5,
    isRestricted18Plus: false,
  },
  '5411': {
    category: 'FOOD',
    label: 'Продуктовые магазины',
    cashbackPercent: 2,
    isRestricted18Plus: false,
  },

  // --- ТРАНСПОРТ ---
  '4111': {
    category: 'TRANSPORT',
    label: 'Общественный транспорт и метро',
    cashbackPercent: 5,
    isRestricted18Plus: false,
  },
  '4121': {
    category: 'TRANSPORT',
    label: 'Такси и каршеринг',
    cashbackPercent: 2,
    isRestricted18Plus: false,
  },

  // --- ОБРАЗОВАНИЕ И КНИГИ ---
  '5942': {
    category: 'EDUCATION',
    label: 'Книжные магазины',
    cashbackPercent: 10,
    isRestricted18Plus: false,
  }, // Повышенный кэшбэк для детей!
  '5943': {
    category: 'EDUCATION',
    label: 'Канцтовары и школьные принадлежности',
    cashbackPercent: 7,
    isRestricted18Plus: false,
  },
  '8299': {
    category: 'EDUCATION',
    label: 'Образовательные курсы и школы',
    cashbackPercent: 5,
    isRestricted18Plus: false,
  },

  // --- РАЗВЛЕЧЕНИЯ И ПОДПИСКИ ---
  '5816': {
    category: 'ENTERTAINMENT',
    label: 'Онлайн-игры (Steam, Roblox, PlayStation)',
    cashbackPercent: 3,
    isRestricted18Plus: false,
  },
  '5815': {
    category: 'ENTERTAINMENT',
    label: 'Цифровые подписки (Музыка, Кино)',
    cashbackPercent: 5,
    isRestricted18Plus: false,
  },
  '7832': {
    category: 'ENTERTAINMENT',
    label: 'Кинотеатры',
    cashbackPercent: 5,
    isRestricted18Plus: false,
  },

  // --- ЗАПРЕЩЕННЫЕ КАТЕГОРИИ 18+ (Блокируются банком) ---
  '7995': {
    category: 'RESTRICTED_18',
    label: 'Азартные игры, ставки и казино',
    cashbackPercent: 0,
    isRestricted18Plus: true,
  },
  '5921': {
    category: 'RESTRICTED_18',
    label: 'Алкогольные напитки',
    cashbackPercent: 0,
    isRestricted18Plus: true,
  },
  '5993': {
    category: 'RESTRICTED_18',
    label: 'Табачные изделия и вейп-шопы',
    cashbackPercent: 0,
    isRestricted18Plus: true,
  },
  '5967': {
    category: 'RESTRICTED_18',
    label: 'Контент и сервисы 18+',
    cashbackPercent: 0,
    isRestricted18Plus: true,
  },
};

export function resolveMcc(mcc: string): MccRule {
  return (
    MCC_DIRECTORY[mcc] ?? {
      category: 'OTHER',
      label: 'Прочие покупки',
      cashbackPercent: 1,
      isRestricted18Plus: false,
    }
  );
}
