import { describe, expect, it } from 'vitest';
import {
  adminTitle,
  dismissFresh,
  freshCount,
  INITIAL_ALERTS,
  isFresh,
  NEW_ORDER_TTL_MS,
  openOrderIds,
  receiveDashboard,
} from '../../src/client/features/admin/alerts/new-orders';
import { readSoundEnabled } from '../../src/client/features/admin/alerts/sound';
import type { AdminOrderView, Dashboard, OrderStatus } from '../../src/shared/api-types';
import { withThrowingStorage } from '../helpers/markup';

function makeOrder(id: number, status: OrderStatus = 'ORDER_RECEIVED'): AdminOrderView {
  return {
    id,
    orderNumber: `BB${1000 + id}`,
    status,
    paymentMethod: 'COD',
    paymentStatus: 'PENDING',
    deliveryMode: 'BATCH',
    deliveryDate: '2026-10-04',
    locationId: 1,
    locationName: 'MSH',
    slotId: 1,
    slotDeliveryTime: '20:00',
    expressWindow: null,
    isLate: false,
    customerName: 'Customer',
    customerPhone: '9876543210',
    addressDetail: null,
    items: [{ menuItemId: 1, name: 'Biryani', unitPrice: 150, quantity: 1, lineTotal: 150 }],
    itemCount: 1,
    foodSubtotal: 150,
    deliveryFee: 0,
    total: 150,
    createdAt: '2026-10-04T12:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    collectedAt: null,
  };
}

function makeDashboard(orders: {
  batch?: AdminOrderView[];
  express?: AdminOrderView[];
  earlier?: AdminOrderView[];
}): Dashboard {
  return {
    date: '2026-10-04',
    isToday: true,
    serverTime: '12:00',
    controls: {
      ordersPaused: false,
      expressEnabled: true,
      expressAvailableNow: true,
      expressOpensAt: '11:00',
      expressClosesAt: '23:00',
    },
    stock: { itemsOnMenu: 5, itemsWithoutStockToday: 0 },
    summary: {
      newOrders: 0,
      completed: 0,
      cancelled: 0,
      codPending: 0,
      codCollected: 0,
      openOrdersFromEarlierDays: 0,
    },
    batches: orders.batch
      ? [
          {
            slotId: 1,
            locationName: 'MSH',
            deliveryTime: '20:00',
            cutoffTime: '19:30',
            slotTimeChanged: false,
            isOpenNow: true,
            closedToday: false,
            orderCount: orders.batch.length,
            openCount: orders.batch.filter((o) => o.status === 'ORDER_RECEIVED').length,
            itemCount: 1,
            codTotal: 150,
            codPending: 150,
            itemBreakdown: [],
            orders: orders.batch,
          },
        ]
      : [],
    express: {
      activeCount: orders.express?.length ?? 0,
      orders: orders.express ?? [],
    },
    earlierOpenOrders: orders.earlier ?? [],
  };
}

describe('Admin alert state and new orders (AL1-AL6)', () => {
  it('AL1: the first receiveDashboard is a baseline (added [], freshCount 0)', () => {
    const d = makeDashboard({ batch: [makeOrder(1)] });
    const res = receiveDashboard(INITIAL_ALERTS, d, 1000);
    expect(res.added).toEqual([]);
    expect(freshCount(res.state, 1000)).toBe(0);
    expect(isFresh(res.state, 1, 1000)).toBe(false);
  });

  it('AL2: the second receiveDashboard with two new open ids and one new completed id adds open ids only', () => {
    const d1 = makeDashboard({ batch: [makeOrder(1)] });
    const base = receiveDashboard(INITIAL_ALERTS, d1, 1000);

    const d2 = makeDashboard({
      batch: [makeOrder(1), makeOrder(2), makeOrder(3)],
      express: [makeOrder(4, 'COMPLETED')],
    });
    const res = receiveDashboard(base.state, d2, 2000);
    expect(res.added).toEqual([2, 3]);
    expect(freshCount(res.state, 2000)).toBe(2);
    expect(isFresh(res.state, 2, 2000)).toBe(true);
    expect(isFresh(res.state, 3, 2000)).toBe(true);
  });

  it('AL3: freshCount is 0 after NEW_ORDER_TTL_MS and dismissFresh removes one', () => {
    const d1 = makeDashboard({ batch: [makeOrder(1)] });
    const base = receiveDashboard(INITIAL_ALERTS, d1, 1000);

    const d2 = makeDashboard({ batch: [makeOrder(1), makeOrder(2), makeOrder(3)] });
    const res = receiveDashboard(base.state, d2, 2000);

    // After TTL, freshCount drops to 0
    expect(freshCount(res.state, 2000 + NEW_ORDER_TTL_MS)).toBe(0);
    expect(isFresh(res.state, 2, 2000 + NEW_ORDER_TTL_MS)).toBe(false);

    // dismissFresh removes an id
    const dismissed = dismissFresh(res.state, 2);
    expect(isFresh(dismissed, 2, 2000)).toBe(false);
    expect(isFresh(dismissed, 3, 2000)).toBe(true);
    expect(freshCount(dismissed, 2000)).toBe(1);
  });

  it('AL4: openOrderIds covers batch groups, express and earlierOpenOrders, and skips completed and cancelled', () => {
    const d = makeDashboard({
      batch: [makeOrder(1), makeOrder(2, 'COMPLETED')],
      express: [makeOrder(3), makeOrder(4, 'CANCELLED')],
      earlier: [makeOrder(5), makeOrder(6, 'COMPLETED')],
    });
    const ids = openOrderIds(d);
    expect(ids).toEqual([1, 3, 5]);
  });

  it('AL5: adminTitle formats title correctly', () => {
    expect(adminTitle(0)).toBe('BBC Admin');
    expect(adminTitle(3)).toBe('(3) BBC Admin');
  });

  it('AL6: readSoundEnabled under withThrowingStorage returns false without throwing', () => {
    withThrowingStorage(() => {
      expect(readSoundEnabled()).toBe(false);
    });
  });
});
