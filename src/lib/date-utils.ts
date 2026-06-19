import type { TimestampLike } from './types';

export function timestampToDate(value: TimestampLike | null | undefined): Date | null {
  if (value == null) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if ('toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if ('seconds' in value && typeof value.seconds === 'number') {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

export function timestampToDateOrNow(value: TimestampLike | null | undefined): Date {
  return timestampToDate(value) ?? new Date();
}
