import { describe, expect, it } from 'vitest';
import {
  MAX_RECENT_ORDERS,
  RECENT_ORDERS_KEY,
  addRecentOrder,
  parseRecentOrders,
  phoneForOrder,
  readRecentOrders,
  withRecentOrder,
  type RecentOrder,
} from '../../src/client/features/customer/order/recent-orders-storage';
import { withThrowingStorage, withWindowStorage } from '../helpers/markup';

const entry = (n: number, phone = '9876543210'): RecentOrder => ({
  orderNumber: `BB${1000 + n}`,
  phone,
  deliveryDate: '2026-10-04',
});

describe('recent orders', () => {
  it('puts the newest first', () => {
    expect(withRecentOrder([entry(1)], entry(2))).toEqual([entry(2), entry(1)]);
  });

  it('moves a re-added order to the front without duplicating it', () => {
    expect(withRecentOrder([entry(2), entry(1)], entry(1))).toEqual([entry(1), entry(2)]);
  });

  it('caps the list at 10', () => {
    let list: RecentOrder[] = [];
    for (let i = 0; i < 15; i++) list = withRecentOrder(list, entry(i));
    expect(list).toHaveLength(MAX_RECENT_ORDERS);
    expect(list[0]).toEqual(entry(14));
    expect(list[9]).toEqual(entry(5));
  });

  it('parses junk as an empty list', () => {
    expect(parseRecentOrders('junk')).toEqual([]);
    expect(parseRecentOrders(null)).toEqual([]);
    expect(parseRecentOrders('{"a":1}')).toEqual([]);
  });

  it('keeps only the valid entries', () => {
    const raw = JSON.stringify([
      entry(1),
      { orderNumber: 'nope', phone: '9876543210', deliveryDate: '2026-10-04' },
      { orderNumber: 'BB1002', phone: '123', deliveryDate: '2026-10-04' },
      { orderNumber: 'BB1003', phone: '9876543210', deliveryDate: 'tomorrow' },
      entry(4),
      null,
    ]);
    expect(parseRecentOrders(raw)).toEqual([entry(1), entry(4)]);
  });

  it('reads, adds and looks up through storage', () => {
    withWindowStorage({}, () => {
      expect(readRecentOrders()).toEqual([]);
      addRecentOrder(entry(1, '9876543210'));
      addRecentOrder(entry(2, '9123456789'));
      expect(readRecentOrders()).toEqual([entry(2, '9123456789'), entry(1, '9876543210')]);
      expect(phoneForOrder('BB1001')).toBe('9876543210');
      expect(phoneForOrder('BB9999')).toBeNull();
      expect(window.localStorage.getItem(RECENT_ORDERS_KEY)).not.toBeNull();
    });
  });

  it('never throws when storage is blocked', () => {
    withThrowingStorage(() => {
      expect(readRecentOrders()).toEqual([]);
      expect(() => {
        addRecentOrder(entry(1));
      }).not.toThrow();
      expect(phoneForOrder('BB1001')).toBeNull();
    });
  });
});
