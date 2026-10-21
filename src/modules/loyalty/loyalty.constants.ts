export interface PartnerOffer {
  id: string;
  title: string;
  description: string;
  partnerName: string;
  cost: number;
  category: string;
  imageUrl: string;
  discountBadge?: string;
}

export const PARTNER_OFFERS: PartnerOffer[] = [
  {
    id: 'dodo-pizza-promo',
    title: 'Пепперони 25 см в подарок',
    description: 'Промокод на бесплатную сочную пиццу при заказе от 20 BYN в Додо Пицца.',
    partnerName: 'Додо Пицца',
    cost: 50,
    category: 'FOOD',
    imageUrl: 'https://images.unsplash.com/photo-1534308983496-4fabb1a015ee?w=500',
    discountBadge: 'Бесплатно',
  },
  {
    id: 'yandex-plus-1m',
    title: 'Подписка Яндекс Плюс на 30 дней',
    description: 'Кинопоиск, Яндекс Музыка и повышенный кэшбэк баллами на такси и покупки.',
    partnerName: 'Яндекс Плюс',
    cost: 80,
    category: 'ENTERTAINMENT',
    imageUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500',
    discountBadge: '1 месяц',
  },
  {
    id: 'silver-screen-50',
    title: 'Скидка 50% на билет в кино',
    description: 'Скидка 50% на любой стандартный сеанс в сети кинотеатров Silver Screen и mooon.',
    partnerName: 'Silver Screen / mooon',
    cost: 60,
    category: 'ENTERTAINMENT',
    imageUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500',
    discountBadge: '-50%',
  },
  {
    id: 'oz-by-coupon',
    title: 'Купон 15 BYN на книги и мангу',
    description: 'Электронный сертификат на покупку книг, комиксов и сувениров в магазинах OZ.by.',
    partnerName: 'OZ.by',
    cost: 40,
    category: 'EDUCATION',
    imageUrl: 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=500',
    discountBadge: '15 BYN',
  },
  {
    id: '21vek-gadgets',
    title: 'Скидка 25 BYN на гаджеты и технику',
    description: 'Промокод на наушники, мышки, смарт-часы и компьютерную периферию в 21vek.by.',
    partnerName: '21vek.by',
    cost: 100,
    category: 'SHOPPING',
    imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500',
    discountBadge: '25 BYN',
  },
  {
    id: 'mak-by-combo',
    title: 'Комбо-обед с бургером и напитком',
    description: 'Сертификат на аппетитный комбо-ланч в ресторанах Mak.by.',
    partnerName: 'Mak.by',
    cost: 45,
    category: 'FOOD',
    imageUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500',
    discountBadge: 'Комбо',
  },
];

export interface CashbackCategoryOption {
  code: string;
  name: string;
  description: string;
  icon: string;
  multiplier: number;
}

export const AVAILABLE_CASHBACK_CATEGORIES: CashbackCategoryOption[] = [
  {
    code: 'FOOD',
    name: 'Кафе и фастфуд',
    description: 'Пиццерии, бургерные, школьные столовые и кофейни',
    icon: '🍔',
    multiplier: 2,
  },
  {
    code: 'EDUCATION',
    name: 'Книги и образование',
    description: 'Книжные магазины, курсы, канцелярские товары и учебники',
    icon: '📚',
    multiplier: 2,
  },
  {
    code: 'ENTERTAINMENT',
    name: 'Кино и игры',
    description: 'Кинотеатры, игровые платформы, аттракционы и подписки',
    icon: '🎮',
    multiplier: 2,
  },
  {
    code: 'TRANSPORT',
    name: 'Проезд и транспорт',
    description: 'Общественный транспорт, метро, поезда и прокат самокатов',
    icon: '🛴',
    multiplier: 2,
  },
  {
    code: 'SHOPPING',
    name: 'Одежда и маркетплейсы',
    description: 'Wildberries, Ozon, магазины одежды, обуви и аксессуаров',
    icon: '🛍️',
    multiplier: 2,
  },
];
