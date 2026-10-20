import { GoogleGenAI } from '@google/genai';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { z } from 'zod';

@Injectable()
export class PassportService {
  private readonly logger = new Logger(PassportService.name);

  private parsePassportText(rawText: string) {
    const clean = rawText.replace(/\r/g, '');
    const lines = clean
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const stopWords = new Set([
      'REPUBLIC',
      'BELARUS',
      'PASSPORT',
      'NATIONALITY',
      'MINISTRY',
      'INTERNAL',
      'AFFAIRS',
      'BEARER',
      'SIGNATURE',
      'SURNAME',
      'GIVEN',
      'NAMES',
      'NAME',
      'DATE',
      'BIRTH',
      'PLACE',
      'SEX',
      'AUTHORITY',
      'ISSUE',
      'EXPIRY',
      'TYPE',
      'CODE',
      'STATE',
      'SENSE',
      'CAPS',
      'SHIFT',
      'BLR',
      'RUS',
      'MVD',
      'PGT',
      'IPMART',
      'SUN',
    ]);

    // 1. Разбор MRZ (Машиночитаемой зоны)
    let mrzLastName = '';
    let mrzFirstName = '';
    let mrzDocNumber = '';
    let mrzBirthDate = '';
    let mrzPersonalNumber = '';
    let mrzRawPayload = '';

    const mrzLine1Raw = lines.find((l) => /P[<(\[{CKL]?(?:BLR|RUS)/i.test(l));
    if (mrzLine1Raw) {
      const compact = mrzLine1Raw.replace(/\s+/g, '').toUpperCase();
      const prefixMatch = compact.match(/P[<(\[{CKL]?(?:BLR\vert{}RUS)/);
      if (prefixMatch && prefixMatch.index !== undefined) {
        let payload = compact.slice(prefixMatch.index + prefixMatch[0].length);
        payload = payload
          .replace(/[{}\(\)\[\]]/g, '<')
          .replace(/L{3,}/g, '<<<');
        mrzRawPayload = payload;

        const mainPart = payload.split(/<{2,}/)[0];

        let parts = payload.split(/<{2,}/).filter(Boolean);
        if (parts.length === 1 || (parts[0] && parts[0].includes('CC'))) {
          const ccSplit = mainPart.split('CC');
          if (ccSplit.length >= 2) {
            parts = ccSplit;
          }
        }

        if (parts.length >= 2) {
          mrzLastName = parts[0].replace(/[^A-Z]/g, '');
          mrzFirstName = parts[1].replace(/[^A-Z]/g, '');
        } else if (parts.length === 1) {
          mrzLastName = parts[0].replace(/[^A-Z]/g, '');
        }
      }
    }

    // Вторая строка MRZ
    const mrzLine2Raw = lines.find((l) =>
      /[A-Z0-9]{9,10}BLR\d{6}/i.test(l.replace(/\s+/g, '')),
    );
    if (mrzLine2Raw) {
      const compactL2 = mrzLine2Raw.replace(/\s+/g, '').toUpperCase();
      const blrIdx = compactL2.indexOf('BLR');

      if (blrIdx >= 9) {
        mrzDocNumber = compactL2
          .slice(blrIdx - 10, blrIdx - 1)
          .replace(/[^A-Z0-9]/g, '');

        const rawBirth = compactL2
          .slice(blrIdx + 3, blrIdx + 9)
          .replace(/O/g, '0');
        const birthMatch = rawBirth.match(/^(\d{2})(\d{2})(\d{2})$/);
        if (birthMatch) {
          const year =
            parseInt(birthMatch[1], 10) > 35
              ? `19${birthMatch[1]}`
              : `20${birthMatch[1]}`;
          mrzBirthDate = `${birthMatch[3]}.${birthMatch[2]}.${year}`;
        }

        const personalMatch = compactL2
          .slice(blrIdx + 9)
          .match(/(\d{7}[A-Z]\d{3}[A-Z]{2}\d)/);
        if (personalMatch) {
          mrzPersonalNumber = personalMatch[1];
        }
      }
    }

    // 2. Поиск Латинских Фамилии и Имени в визуальной зоне со сверкой по MRZ
    let visualLastName = '';
    let visualFirstName = '';

    const passportHeaderIdx = lines.findIndex((l) =>
      /PASSPORT|ПАШПАРТ/i.test(l),
    );
    const nationalityIdx = lines.findIndex(
      (l, idx) =>
        idx > passportHeaderIdx &&
        /NATIONALITY|ГРАМАДЗЯНСТВА|ДАТА|23\s+07|\d{2}\s+\d{2}\s+\d{4}/i.test(l),
    );

    if (passportHeaderIdx !== -1) {
      const endIdx =
        nationalityIdx !== -1
          ? nationalityIdx
          : Math.min(lines.length, passportHeaderIdx + 8);
      const candidateNames: string[] = [];

      for (let i = passportHeaderIdx + 1; i < endIdx; i++) {
        const upperTokens = lines[i].match(/\b[A-Z]{3,20}\b/g) || [];
        for (const token of upperTokens) {
          // В настоящем имени/фамилии обязательно должна быть хотя бы одна гласная (отсекает 'PGT')
          const hasVowel = /[AEIOUY]/.test(token);
          if (hasVowel && !stopWords.has(token) && !/\d/.test(token)) {
            candidateNames.push(token);
          }
        }
      }

      // Если есть MRZ, фильтруем кандидатов: оставляем те, чьи первые 3 буквы совпадают с MRZ
      if (mrzRawPayload && candidateNames.length > 2) {
        const verified = candidateNames.filter((c) =>
          mrzRawPayload.includes(c.slice(0, 3)),
        );
        if (verified.length >= 2) {
          visualLastName = verified[0];
          visualFirstName = verified[1];
        }
      }

      if (!visualLastName && candidateNames.length >= 1) {
        visualLastName = candidateNames[0];
      }
      if (!visualFirstName && candidateNames.length >= 2) {
        visualFirstName = candidateNames[1];
      }
    }

    // 3. Поиск кириллического Отчества
    let middleName = '';
    const cleanWord = (w: string) =>
      w.replace(/[^A-Za-zА-Яа-яЁёІіЎў\-]/g, '').trim();

    for (let i = 0; i < lines.length; i++) {
      const current = lines[i];

      if (/(?:отчеств|бацьк)/i.test(current) && !middleName) {
        const candidates = [current, lines[i + 1] || ''];
        for (const line of candidates) {
          const words = line
            .split(/[\s:,\/-]+/)
            .map(cleanWord)
            .filter(
              (w) =>
                w.length >= 3 &&
                !/(?:отчеств|бацьк|имя|імя)/i.test(w) &&
                /^[А-ЯЁІЎ\-]+$/i.test(w),
            );
          if (words.length > 0) {
            middleName = words[0].toUpperCase();
            break;
          }
        }
      }
    }

    // 4. Прямой поиск номеров и дат по всему тексту (RegEx)
    const docNumberMatch = clean.match(
      /\b([A-Z]{2}\s?\d{7})\b|\b(\d{2}\s?\d{2}\s?\d{6})\b/i,
    );
    const personalNumberMatch = clean.match(/\b\d{7}[A-Z]\d{3}[A-Z]{2}\d\b/i);
    const dates = clean.match(/\b\d{2}[.\s/-]\d{2}[.\s/-]\d{4}\b/g) || [];

    return {
      lastName: visualLastName || mrzLastName,
      firstName: visualFirstName || mrzFirstName,
      middleName,
      documentNumber:
        (docNumberMatch
          ? docNumberMatch[0].replace(/\s/g, '').toUpperCase()
          : '') || mrzDocNumber,
      personalNumber:
        (personalNumberMatch ? personalNumberMatch[0].toUpperCase() : '') ||
        mrzPersonalNumber,
      birthDate: dates[0]
        ? dates[0].trim().replace(/[\s/-]+/g, '.')
        : mrzBirthDate,
    };
  }

  async recognize(file: Express.Multer.File) {
    let worker;
    try {
      const optimizedBuffer = await sharp(file.buffer)
        .resize({
          width: 1600,
          withoutEnlargement: true,
        })
        .grayscale()
        .normalize()
        .toBuffer();

      worker = await createWorker(['rus', 'eng']);
      const ret = await worker.recognize(optimizedBuffer);
      const rawText = ret.data.text;

      if (!rawText || rawText.trim().length === 0) {
        throw new InternalServerErrorException(
          'Tesseract не смог обнаружить текст на изображении',
        );
      }

      this.logger.debug(`Сырой текст от Tesseract:\n${rawText}`);

      // const response = await this.ai.models.generateContent({
      //   model: 'gemini-3.8-flash',
      //   contents: [
      //     {
      //       text: `Вот распознанный сырой текст с разворота паспорта (получен через OCR с возможными ошибками распознавания).
      //       Извлеки из него данные и разложи по структуре. Если поле не найдено или сомнительно, верни пустую строку. Не додумывай лишнего.

      //       Сырой текст:
      //       ${rawText}`,
      //     },
      //   ],
      //   config: {
      //     responseMimeType: 'application/json',
      //     responseJsonSchema: z.toJSONSchema(PassportSchema),
      //   },
      // });

      // const responseText = response.text;
      // if (!responseText) {
      //   throw new InternalServerErrorException('Gemini не вернул ответ');
      // }

      // this.logger.log(responseText);
      const parsedJson = this.parsePassportText(rawText);

      // const parsedJson = JSON.parse(responseText);
      return parsedJson;
    } catch (error) {
      this.logger.error(
        `Ошибка при обработке паспорта: ${error.message}`,
        error.stack,
      );

      // if (error instanceof z.ZodError) {
      //   throw new InternalServerErrorException(
      //     'Ошибка валидации структуры данных паспорта',
      //   );
      // }

      // throw new InternalServerErrorException(
      //   error.message || 'Не удалось распознать документ',
      // );
    } finally {
      // 5. Обязательно освобождаем память воркера Tesseract
      if (worker) {
        await worker.terminate();
      }
    }
  }
}
