const ISO_DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR_DATE_PATTERN = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/;

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function dateFromParts(year: number, month: number, day: number): Date | undefined {
  if (!isValidDateParts(year, month, day)) return undefined;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function parseDateOnlyString(value: string): Date | undefined {
  const isoMatch = value.match(ISO_DATE_ONLY_PATTERN);
  if (isoMatch) {
    return dateFromParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const brMatch = value.match(BR_DATE_PATTERN);
  if (brMatch) {
    let year = Number(brMatch[3]);
    if (year < 100) year += 2000;
    return dateFromParts(year, Number(brMatch[2]), Number(brMatch[1]));
  }

  return undefined;
}

function parseExcelSerialDate(serial: number): Date | undefined {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return undefined;

  const utcMillis = Math.round((serial - 25569) * 86400 * 1000);
  const utcDate = new Date(utcMillis);
  if (Number.isNaN(utcDate.getTime())) return undefined;

  return dateFromParts(
    utcDate.getUTCFullYear(),
    utcDate.getUTCMonth() + 1,
    utcDate.getUTCDate(),
  );
}

export function parseSpreadsheetDate(value: unknown, fallback = new Date()): Date {
  if (value === null || value === undefined || value === '') return fallback;

  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) {
      return dateFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate()) || value;
    }
    return fallback;
  }

  if (typeof value === 'number') {
    return parseExcelSerialDate(value) || fallback;
  }

  const cleanValue = String(value).trim();
  if (!cleanValue) return fallback;

  const dateOnly = parseDateOnlyString(cleanValue);
  if (dateOnly) return dateOnly;

  if (/^\d+(\.\d+)?$/.test(cleanValue)) {
    const numericValue = Number(cleanValue);
    if (numericValue > 30000 && numericValue < 60000) {
      return parseExcelSerialDate(numericValue) || fallback;
    }
    if (numericValue > 10000000000) {
      const timestampDate = new Date(numericValue);
      if (!Number.isNaN(timestampDate.getTime())) return timestampDate;
    }
    if (numericValue > 1000000000) {
      const timestampDate = new Date(numericValue * 1000);
      if (!Number.isNaN(timestampDate.getTime())) return timestampDate;
    }
  }

  const parsed = new Date(cleanValue);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  return fallback;
}

export function normalizeSpreadsheetDateOnly(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;

  const cleanValue = String(value).trim();
  const date = parseSpreadsheetDate(value, new Date(NaN));
  if (Number.isNaN(date.getTime())) return undefined;

  const isoDateOnly = cleanValue.match(ISO_DATE_ONLY_PATTERN);
  if (isoDateOnly && parseDateOnlyString(cleanValue)) return cleanValue;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
