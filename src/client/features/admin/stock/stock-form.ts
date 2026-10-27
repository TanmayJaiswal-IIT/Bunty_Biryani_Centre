import type { AdminMenuItem } from '@shared/api-types.js';
import { STOCK_MAX } from '@shared/limits.js';
import type { ApiError } from '../../../lib/api.js';

export type StockInputs = Record<number, string>;

export interface StockEntryInput {
  menuItemId: number;
  stock: number;
}

export function initialInputs(items: AdminMenuItem[]): StockInputs {
  const result: StockInputs = {};
  for (const item of items) {
    result[item.id] = item.stockSetToday ? String(item.dailyStock) : '';
  }
  return result;
}

export function useYesterday(
  items: AdminMenuItem[],
  inputs: StockInputs,
): StockInputs {
  const next: StockInputs = { ...inputs };
  for (const item of items) {
    if (!item.stockSetToday && item.stockDate !== null) {
      const current = inputs[item.id] ?? '';
      if (current === '') {
        next[item.id] = String(item.dailyStock);
      }
    }
  }
  return next;
}

export function rowError(item: AdminMenuItem, raw: string): string | null {
  if (raw === '') return null;

  if (!/^\d+$/.test(raw)) {
    return `Enter a whole number from 0 to ${STOCK_MAX}`;
  }

  const num = Number(raw);
  if (num < 0 || num > STOCK_MAX) {
    return `Enter a whole number from 0 to ${STOCK_MAX}`;
  }

  if (num < item.soldToday) {
    return `Already sold ${item.soldToday} today. Enter ${item.soldToday} or more.`;
  }

  return null;
}

export function changedEntries(
  items: AdminMenuItem[],
  inputs: StockInputs,
): StockEntryInput[] {
  const result: StockEntryInput[] = [];

  for (const item of items) {
    const raw = inputs[item.id] ?? '';
    const err = rowError(item, raw);
    if (err !== null) continue;

    if (item.stockSetToday) {
      if (raw !== '' && Number(raw) !== item.dailyStock) {
        result.push({ menuItemId: item.id, stock: Number(raw) });
      }
    } else {
      if (raw !== '') {
        result.push({ menuItemId: item.id, stock: Number(raw) });
      }
    }
  }

  return result;
}

export function isDirty(items: AdminMenuItem[], inputs: StockInputs): boolean {
  for (const item of items) {
    const initial = item.stockSetToday ? String(item.dailyStock) : '';
    const current = inputs[item.id] ?? '';
    if (current !== initial) {
      return true;
    }
  }
  return false;
}

export const applyYesterday = useYesterday;

export function serverRowErrors(
  err: ApiError,
  _items?: AdminMenuItem[],
): Record<number, string> {
  void _items;
  const result: Record<number, string> = {};
  const details = err.details as
    | { items?: Array<{ menuItemId: number; sold: number }> }
    | undefined;

  if (details && Array.isArray(details.items)) {
    for (const entry of details.items) {
      result[entry.menuItemId] =
        `Already sold ${entry.sold} today. Enter ${entry.sold} or more.`;
    }
  }

  return result;
}

export function orderedForStock(items: AdminMenuItem[]): {
  onMenu: AdminMenuItem[];
  hidden: AdminMenuItem[];
} {
  return {
    onMenu: items.filter((i) => i.isAvailable),
    hidden: items.filter((i) => !i.isAvailable),
  };
}
