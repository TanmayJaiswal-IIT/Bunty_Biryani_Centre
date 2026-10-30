import { describe, expect, it } from 'vitest';
import {
  groupBatches,
  sortExpress,
  type GroupingInput,
} from '../../src/server/services/dashboard.service.js';
import type { AdminOrderView } from '../../src/shared/schemas/admin-views.js';

function makeOrder(overrides: Partial<AdminOrderView> = {}): AdminOrderView {
  return {
    id: 1,
    orderNumber: 'BB1001',
    status: 'ORDER_RECEIVED',
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
    customerName: 'Rahul Verma',
    customerPhone: '9876543210',
    addressDetail: 'Room 214',
    items: [
      {
        menuItemId: 1,
        name: 'Chicken Biryani',
        unitPrice: 150,
        quantity: 2,
        lineTotal: 300,
      },
    ],
    itemCount: 2,
    foodSubtotal: 300,
    deliveryFee: 0,
    total: 300,
    createdAt: '2026-10-04T13:40:00.000Z',
    completedAt: null,
    cancelledAt: null,
    collectedAt: null,
    ...overrides,
  };
}

const defaultSlots: GroupingInput['slots'] = [
  {
    id: 1,
    locationId: 1,
    deliveryTime: '20:00',
    cutoffTime: '19:30',
    isActive: true,
    closedOn: null,
    location: { id: 1, name: 'MSH', isActive: true, sortOrder: 1 },
  },
  {
    id: 2,
    locationId: 2,
    deliveryTime: '20:45',
    cutoffTime: '20:15',
    isActive: true,
    closedOn: null,
    location: { id: 2, name: 'Kanhar', isActive: true, sortOrder: 2 },
  },
];

describe('dashboard grouping unit tests (#2)', () => {
  const today = { date: '2026-10-04', time: '19:10' };

  it('(a) Brief §6: three MSH 20:00 orders -> one group, orderCount 3', () => {
    const o1 = makeOrder({ id: 1, orderNumber: 'BB1001' });
    const o2 = makeOrder({ id: 2, orderNumber: 'BB1002' });
    const o3 = makeOrder({ id: 3, orderNumber: 'BB1003' });

    const batches = groupBatches({
      date: '2026-10-04',
      isToday: true,
      today,
      slots: defaultSlots,
      orders: [o1, o2, o3],
    });

    const mshGroup = batches.find((b) => b.slotId === 1);
    expect(mshGroup).toBeDefined();
    expect(mshGroup?.orderCount).toBe(3);
    expect(mshGroup?.orders).toHaveLength(3);
  });

  it('(b) Cancelled orders: listed last, excluded from orderCount, itemCount, codTotal, codPending, breakdown', () => {
    const active = makeOrder({ id: 1, total: 300, paymentStatus: 'PENDING' });
    const cancelled = makeOrder({
      id: 2,
      orderNumber: 'BB1002',
      status: 'CANCELLED',
      total: 500,
      items: [{ menuItemId: 2, name: 'Paneer Biryani', unitPrice: 130, quantity: 3, lineTotal: 390 }],
      itemCount: 3,
    });

    const batches = groupBatches({
      date: '2026-10-04',
      isToday: true,
      today,
      slots: defaultSlots,
      orders: [active, cancelled],
    });

    const group = batches.find((b) => b.slotId === 1)!;
    expect(group.orderCount).toBe(1);
    expect(group.itemCount).toBe(2);
    expect(group.codTotal).toBe(300);
    expect(group.codPending).toBe(300);
    expect(group.itemBreakdown).toEqual([
      { menuItemId: 1, name: 'Chicken Biryani', quantity: 2 },
    ]);
    expect(group.orders[1]?.status).toBe('CANCELLED');
  });

  it('(c) Completed orders: counted in orderCount, not in openCount; codPending vs codTotal split', () => {
    const openOrder = makeOrder({ id: 1, status: 'ORDER_RECEIVED', total: 300, paymentStatus: 'PENDING' });
    const completedOrder = makeOrder({
      id: 2,
      orderNumber: 'BB1002',
      status: 'COMPLETED',
      total: 300,
      paymentStatus: 'COLLECTED',
      completedAt: '2026-10-04T14:00:00.000Z',
    });

    const batches = groupBatches({
      date: '2026-10-04',
      isToday: true,
      today,
      slots: defaultSlots,
      orders: [openOrder, completedOrder],
    });

    const group = batches.find((b) => b.slotId === 1)!;
    expect(group.orderCount).toBe(2);
    expect(group.openCount).toBe(1);
    expect(group.codTotal).toBe(600);
    expect(group.codPending).toBe(300);
  });

  it('(d) Empty slots: zero-order active slot present for today, absent for past date; inactive slot with no orders absent', () => {
    const inactiveSlot: GroupingInput['slots'][0] = {
      id: 3,
      locationId: 3,
      deliveryTime: '21:00',
      cutoffTime: '20:30',
      isActive: false,
      closedOn: null,
      location: { id: 3, name: 'Inactive Location', isActive: true, sortOrder: 3 },
    };

    // Today: active slots with 0 orders appear
    const todayBatches = groupBatches({
      date: '2026-10-04',
      isToday: true,
      today,
      slots: [...defaultSlots, inactiveSlot],
      orders: [],
    });
    expect(todayBatches.map((b) => b.slotId)).toEqual([1, 2]);

    // Past date: zero-order slots are absent
    const pastBatches = groupBatches({
      date: '2026-10-03',
      isToday: false,
      today,
      slots: [...defaultSlots, inactiveSlot],
      orders: [],
    });
    expect(pastBatches).toEqual([]);
  });

  it('(e) Changed slot time: orders at 20:00 and slot now 20:15 -> two groups, sorted by time', () => {
    const slotModified: GroupingInput['slots'] = [
      {
        id: 1,
        locationId: 1,
        deliveryTime: '20:15',
        cutoffTime: '19:45',
        isActive: true,
        closedOn: null,
        location: { id: 1, name: 'MSH', isActive: true, sortOrder: 1 },
      },
    ];

    const orderOldTime = makeOrder({
      id: 1,
      slotId: 1,
      slotDeliveryTime: '20:00',
    });

    const batches = groupBatches({
      date: '2026-10-04',
      isToday: true,
      today,
      slots: slotModified,
      orders: [orderOldTime],
    });

    expect(batches).toHaveLength(2);
    // Sorted by deliveryTime: 20:00 then 20:15
    expect(batches[0]?.deliveryTime).toBe('20:00');
    expect(batches[0]?.slotTimeChanged).toBe(true);
    expect(batches[0]?.orderCount).toBe(1);

    expect(batches[1]?.deliveryTime).toBe('20:15');
    expect(batches[1]?.slotTimeChanged).toBe(false);
    expect(batches[1]?.orderCount).toBe(0);
  });

  it('(f) Breakdown: merges by menuItemId, largest first', () => {
    const o1 = makeOrder({
      id: 1,
      items: [
        { menuItemId: 1, name: 'Chicken Biryani', unitPrice: 150, quantity: 4, lineTotal: 600 },
        { menuItemId: 2, name: 'Paneer Biryani', unitPrice: 130, quantity: 1, lineTotal: 130 },
      ],
    });
    const o2 = makeOrder({
      id: 2,
      items: [
        { menuItemId: 1, name: 'Chicken Biryani', unitPrice: 150, quantity: 4, lineTotal: 600 },
      ],
    });

    const batches = groupBatches({
      date: '2026-10-04',
      isToday: true,
      today,
      slots: defaultSlots,
      orders: [o1, o2],
    });

    const group = batches.find((b) => b.slotId === 1)!;
    expect(group.itemBreakdown).toEqual([
      { menuItemId: 1, name: 'Chicken Biryani', quantity: 8 },
      { menuItemId: 2, name: 'Paneer Biryani', quantity: 1 },
    ]);
  });

  it('(g) Group sort: equal times -> location sortOrder', () => {
    const slotsEqualTime: GroupingInput['slots'] = [
      {
        id: 10,
        locationId: 10,
        deliveryTime: '20:00',
        cutoffTime: '19:30',
        isActive: true,
        closedOn: null,
        location: { id: 10, name: 'Second Loc', isActive: true, sortOrder: 2 },
      },
      {
        id: 11,
        locationId: 11,
        deliveryTime: '20:00',
        cutoffTime: '19:30',
        isActive: true,
        closedOn: null,
        location: { id: 11, name: 'First Loc', isActive: true, sortOrder: 1 },
      },
    ];

    const batches = groupBatches({
      date: '2026-10-04',
      isToday: true,
      today,
      slots: slotsEqualTime,
      orders: [],
    });

    expect(batches.map((b) => b.slotId)).toEqual([11, 10]);
  });

  it('(h) sortExpress: ORDER_RECEIVED by createdAt asc, COMPLETED by createdAt desc, CANCELLED last', () => {
    const openEarly = makeOrder({ id: 1, deliveryMode: 'EXPRESS', status: 'ORDER_RECEIVED', createdAt: '2026-10-04T12:00:00.000Z' });
    const openLate = makeOrder({ id: 2, deliveryMode: 'EXPRESS', status: 'ORDER_RECEIVED', createdAt: '2026-10-04T13:00:00.000Z' });
    const compEarly = makeOrder({ id: 3, deliveryMode: 'EXPRESS', status: 'COMPLETED', createdAt: '2026-10-04T11:00:00.000Z' });
    const compLate = makeOrder({ id: 4, deliveryMode: 'EXPRESS', status: 'COMPLETED', createdAt: '2026-10-04T14:00:00.000Z' });
    const cancelled = makeOrder({ id: 5, deliveryMode: 'EXPRESS', status: 'CANCELLED', createdAt: '2026-10-04T10:00:00.000Z' });

    const sorted = sortExpress([compEarly, cancelled, openLate, compLate, openEarly]);
    expect(sorted.map((o) => o.id)).toEqual([1, 2, 4, 3, 5]);
  });
});
