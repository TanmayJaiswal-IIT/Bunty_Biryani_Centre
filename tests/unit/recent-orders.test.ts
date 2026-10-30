import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRecentOrderPhone,
  MAX_RECENT_ORDERS,
  readRecentOrders,
  RECENT_ORDERS_KEY,
  saveRecentOrder,
} from '../../src/client/features/customer/order/recent-orders-storage';

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
}

describe('Recent orders storage (Batch 5 §10)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      localStorage: fakeStorage(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads empty array when nothing stored or corrupt', () => {
    expect(readRecentOrders()).toEqual([]);
    window.localStorage.setItem(RECENT_ORDERS_KEY, 'invalid json');
    expect(readRecentOrders()).toEqual([]);
    window.localStorage.setItem(RECENT_ORDERS_KEY, JSON.stringify([{ bad: 'data' }]));
    expect(readRecentOrders()).toEqual([]);
  });

  it('saves recent orders newest first and de-duplicates by order number', () => {
    saveRecentOrder({ orderNumber: 'BB1001', phone: '9876543210', deliveryDate: '2026-10-04' });
    saveRecentOrder({ orderNumber: 'BB1002', phone: '9876543210', deliveryDate: '2026-10-04' });

    let orders = readRecentOrders();
    expect(orders).toHaveLength(2);
    expect(orders[0]?.orderNumber).toBe('BB1002');
    expect(orders[1]?.orderNumber).toBe('BB1001');

    // Re-saving BB1001 moves it to front
    saveRecentOrder({ orderNumber: 'bb1001', phone: '9876543210', deliveryDate: '2026-10-04' });
    orders = readRecentOrders();
    expect(orders).toHaveLength(2);
    expect(orders[0]?.orderNumber).toBe('bb1001');
    expect(orders[1]?.orderNumber).toBe('BB1002');
  });

  it('caps at MAX_RECENT_ORDERS (10)', () => {
    for (let i = 1; i <= 15; i++) {
      saveRecentOrder({
        orderNumber: `BB10${i < 10 ? '0' + i : i}`,
        phone: '9876543210',
        deliveryDate: '2026-10-04',
      });
    }
    const orders = readRecentOrders();
    expect(orders).toHaveLength(MAX_RECENT_ORDERS);
    expect(orders[0]?.orderNumber).toBe('BB1015');
  });

  it('gets phone for stored order number case-insensitively', () => {
    saveRecentOrder({ orderNumber: 'BB1023', phone: '9876543210', deliveryDate: '2026-10-04' });
    expect(getRecentOrderPhone('bb1023')).toBe('9876543210');
    expect(getRecentOrderPhone('BB1023')).toBe('9876543210');
    expect(getRecentOrderPhone('BB9999')).toBeNull();
  });
});
