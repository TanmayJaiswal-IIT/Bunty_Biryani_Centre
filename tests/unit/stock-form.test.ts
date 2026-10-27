import { describe, expect, it } from 'vitest';
import type { AdminMenuItem } from '../../src/shared/api-types';
import { ApiError } from '../../src/client/lib/api';
import {
  changedEntries,
  initialInputs,
  isDirty,
  orderedForStock,
  rowError,
  serverRowErrors,
  useYesterday,
} from '../../src/client/features/admin/stock/stock-form';

function makeItem(over: Partial<AdminMenuItem> = {}): AdminMenuItem {
  return {
    id: 1,
    name: 'Chicken Biryani',
    description: null,
    price: 150,
    imageUrl: null,
    isAvailable: true,
    sortOrder: 0,
    dailyStock: 20,
    stockRemaining: 15,
    stockDate: '2026-10-04',
    stockSetToday: true,
    soldToday: 5,
    ...over,
  };
}

describe('Stock form logic (SF1-SF4)', () => {
  it('SF1: initialInputs and useYesterday behavior', () => {
    const item1 = makeItem({ id: 1, stockSetToday: true, dailyStock: 30 });
    const item2 = makeItem({
      id: 2,
      stockSetToday: false,
      stockDate: '2026-10-03',
      dailyStock: 25,
    });
    const item3 = makeItem({
      id: 3,
      stockSetToday: false,
      stockDate: null,
      dailyStock: 0,
    });

    const items = [item1, item2, item3];
    const initial = initialInputs(items);

    expect(initial).toEqual({
      1: '30',
      2: '',
      3: '',
    });

    // useYesterday fills item2, does not overwrite typed value, skips never-stocked item3
    const userTyped = { ...initial, 2: '15' };
    const resultWithTyped = useYesterday(items, userTyped);
    expect(resultWithTyped[2]).toBe('15'); // does not overwrite typed

    const emptyInputs = { 1: '30', 2: '', 3: '' };
    const filled = useYesterday(items, emptyInputs);
    expect(filled[2]).toBe('25'); // filled from dailyStock
    expect(filled[3]).toBe(''); // skipped item with null stockDate
  });

  it('SF2: rowError covers empty, valid, non-integer, 10001, and below-sold', () => {
    const item = makeItem({ id: 1, soldToday: 22 });

    expect(rowError(item, '')).toBeNull();
    expect(rowError(item, '25')).toBeNull();
    expect(rowError(item, 'abc')).toBe('Enter a whole number from 0 to 10000');
    expect(rowError(item, '-5')).toBe('Enter a whole number from 0 to 10000');
    expect(rowError(item, '10001')).toBe('Enter a whole number from 0 to 10000');
    expect(rowError(item, '21')).toBe(
      'Already sold 22 today. Enter 22 or more.',
    );
    expect(rowError(item, '22')).toBeNull();
  });

  it('SF3: changedEntries skips unchanged and empty not-set rows', () => {
    const item1 = makeItem({ id: 1, stockSetToday: true, dailyStock: 30 });
    const item2 = makeItem({ id: 2, stockSetToday: false, dailyStock: 0 });
    const item3 = makeItem({ id: 3, stockSetToday: false, dailyStock: 0 });
    const item4 = makeItem({ id: 4, stockSetToday: true, dailyStock: 40 });

    const items = [item1, item2, item3, item4];
    const inputs = {
      1: '30', // unchanged
      2: '', // empty not-set -> skipped
      3: '15', // filled not-set -> included
      4: '50', // changed set-today -> included
    };

    const entries = changedEntries(items, inputs);
    expect(entries).toEqual([
      { menuItemId: 3, stock: 15 },
      { menuItemId: 4, stock: 50 },
    ]);
    expect(isDirty(items, inputs)).toBe(true);
  });

  it('SF4: serverRowErrors maps STOCK_BELOW_SOLD details onto rows', () => {
    const err = new ApiError(409, 'STOCK_BELOW_SOLD', 'Stock error', {
      items: [{ menuItemId: 1, sold: 18 }],
    });
    const items = [makeItem({ id: 1 })];

    const mapped = serverRowErrors(err, items);
    expect(mapped[1]).toBe('Already sold 18 today. Enter 18 or more.');

    const regularErr = new ApiError(500, 'INTERNAL_ERROR', 'Server error');
    expect(serverRowErrors(regularErr, items)).toEqual({});
  });

  it('orderedForStock separates available and hidden items', () => {
    const item1 = makeItem({ id: 1, isAvailable: true });
    const item2 = makeItem({ id: 2, isAvailable: false });

    const { onMenu, hidden } = orderedForStock([item1, item2]);
    expect(onMenu).toEqual([item1]);
    expect(hidden).toEqual([item2]);
  });
});
