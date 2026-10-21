const CARD_PREFIX = '4258';

export function generateCardNumber() {
  let middle = '';

  for (let index = 0; index < 8; index += 1) {
    middle += Math.floor(Math.random() * 10).toString();
  }

  const last = Math.floor(1000 + Math.random() * 9000).toString();

  return `${CARD_PREFIX}${middle}${last}`;
}

export function toCardNumberMask(cardNumber: string) {
  return `${cardNumber.slice(0, 4)} •••• •••• ${cardNumber.slice(-4)}`;
}
