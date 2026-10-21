ALTER TABLE "Card" ADD COLUMN "cardNumber" TEXT;

UPDATE "Card"
SET "cardNumber" =
  '4258' ||
  LPAD((FLOOR(RANDOM() * 100000000))::INT::TEXT, 8, '0') ||
  RIGHT(REGEXP_REPLACE("cardNumberMask", '[^0-9]', '', 'g'), 4)
WHERE "cardNumber" IS NULL;

ALTER TABLE "Card" ALTER COLUMN "cardNumber" SET NOT NULL;

CREATE UNIQUE INDEX "Card_cardNumber_key" ON "Card"("cardNumber");
