import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/server/lib/app-error';
import { pathId } from '../../src/server/lib/path-id';
import {
  completeManySchema,
  dashboardQuerySchema,
  locationCreateSchema,
  locationUpdateSchema,
  menuItemCreateSchema,
  menuItemUpdateSchema,
  orderActionSchema,
  ordersQuerySchema,
  settingsUpdateSchema,
  slotCreateSchema,
  slotUpdateSchema,
  stockBulkSchema,
} from '../../src/shared/schemas/admin';
import {
  adminLocationSchema,
  adminMenuItemSchema,
  adminMenuResponseSchema,
  adminOrderViewSchema,
  adminOrdersResponseSchema,
  adminSettingsSchema,
  adminSlotSchema,
  completeManyResultSchema,
  dashboardBatchSchema,
  dashboardSchema,
} from '../../src/shared/schemas/admin-views';

function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

function issuePaths(r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (r.error?.issues ?? []).map((i) => i.path.join('.'));
}

describe('orderActionSchema', () => {
  it('AS1 accepts exactly one of status or paymentStatus', () => {
    expect(orderActionSchema.parse({ status: 'CANCELLED' })).toEqual({ status: 'CANCELLED' });
    expect(orderActionSchema.parse({ paymentStatus: 'COLLECTED' })).toEqual({
      paymentStatus: 'COLLECTED',
    });
  });

  it('AS1 rejects {}, both keys, an unknown status and an extra key', () => {
    expect(orderActionSchema.safeParse({}).success).toBe(false);
    expect(
      orderActionSchema.safeParse({ status: 'COMPLETED', paymentStatus: 'COLLECTED' }).success,
    ).toBe(false);
    expect(orderActionSchema.safeParse({ status: 'PAID' }).success).toBe(false);
    expect(orderActionSchema.safeParse({ status: 'COMPLETED', note: 'x' }).success).toBe(false);
  });
});

describe('completeManySchema', () => {
  it('AS2 accepts a list of unique ids', () => {
    expect(completeManySchema.parse({ orderIds: [57, 58, 61], markCollected: true })).toEqual({
      orderIds: [57, 58, 61],
      markCollected: true,
    });
  });

  it('AS2 rejects [], 201 ids, a duplicate id, 0, -1, a huge id and an extra key', () => {
    const bad = (orderIds: number[]) =>
      completeManySchema.safeParse({ orderIds, markCollected: false }).success;
    expect(bad([])).toBe(false);
    expect(bad(Array.from({ length: 201 }, (_, i) => i + 1))).toBe(false);
    expect(bad([5, 5])).toBe(false);
    expect(bad([0])).toBe(false);
    expect(bad([-1])).toBe(false);
    expect(bad([2_147_483_648])).toBe(false);
    expect(bad(Array.from({ length: 200 }, (_, i) => i + 1))).toBe(true);
    expect(
      completeManySchema.safeParse({ orderIds: [1], markCollected: true, all: true }).success,
    ).toBe(false);
    expect(completeManySchema.safeParse({ orderIds: [1] }).success).toBe(false);
  });
});

describe('menu item schemas', () => {
  const create = { name: 'Chicken Biryani', price: 150 };

  it('AS3 create: trims and collapses the name, defaults isAvailable to true', () => {
    expect(menuItemCreateSchema.parse({ ...create, name: '  Chicken   Biryani ' })).toEqual({
      name: 'Chicken Biryani',
      price: 150,
      isAvailable: true,
    });
  });

  it('AS3 rejects price 0, a float price, a price above the max and a one-letter name', () => {
    expect(menuItemCreateSchema.safeParse({ ...create, price: 0 }).success).toBe(false);
    expect(menuItemCreateSchema.safeParse({ ...create, price: 99.5 }).success).toBe(false);
    expect(menuItemCreateSchema.safeParse({ ...create, price: 10_001 }).success).toBe(false);
    expect(menuItemCreateSchema.safeParse({ ...create, price: 10_000 }).success).toBe(true);
    expect(menuItemCreateSchema.safeParse({ ...create, name: ' a ' }).success).toBe(false);
    expect(menuItemCreateSchema.safeParse({ ...create, name: 'x'.repeat(61) }).success).toBe(false);
  });

  it('AS3 rejects http:// and non-URL image links, accepts https, and turns "" into null', () => {
    const img = (imageUrl: unknown) => menuItemCreateSchema.safeParse({ ...create, imageUrl });
    expect(img('http://example.com/a.jpg').success).toBe(false);
    expect(img('javascript:alert(1)').success).toBe(false);
    expect(img('not a url').success).toBe(false);
    expect(img(`https://example.com/${'a'.repeat(500)}`).success).toBe(false);
    expect(img('https://example.com/a.jpg').data?.imageUrl).toBe('https://example.com/a.jpg');
    expect(img('').data?.imageUrl).toBeNull();
    expect(img(null).data?.imageUrl).toBeNull();
  });

  it('AS3 turns an empty description into null and caps it at 200 characters', () => {
    const desc = (description: unknown) =>
      menuItemCreateSchema.safeParse({ ...create, description });
    expect(desc('').data?.description).toBeNull();
    expect(desc('   ').data?.description).toBeNull();
    expect(desc('Slow-cooked').data?.description).toBe('Slow-cooked');
    expect(desc('x'.repeat(200)).success).toBe(true);
    expect(desc('x'.repeat(201)).success).toBe(false);
  });

  it('AS3 rejects stock fields as unknown keys (strict), on create and update', () => {
    expect(menuItemCreateSchema.safeParse({ ...create, stockRemaining: 5 }).success).toBe(false);
    expect(menuItemCreateSchema.safeParse({ ...create, dailyStock: 5 }).success).toBe(false);
    expect(menuItemCreateSchema.safeParse({ ...create, sortOrder: 3 }).success).toBe(false);
    expect(menuItemUpdateSchema.safeParse({ stockRemaining: 5 }).success).toBe(false);
    expect(menuItemUpdateSchema.safeParse({ price: 160, stockDate: '2026-10-04' }).success).toBe(
      false,
    );
  });

  it('AS3 update: an empty update {} is rejected', () => {
    const r = menuItemUpdateSchema.safeParse({});
    expect(r.success).toBe(false);
    expect(menuItemUpdateSchema.safeParse({ description: undefined }).success).toBe(false);
  });

  it('AS3 update: has no defaults, so only the keys sent come back', () => {
    expect(menuItemUpdateSchema.parse({ price: 160 })).toEqual({ price: 160 });
    expect(menuItemUpdateSchema.parse({ isAvailable: false })).toEqual({ isAvailable: false });
    expect(menuItemUpdateSchema.parse({ sortOrder: 0 })).toEqual({ sortOrder: 0 });
  });

  it('AS3 update: "" clears the description and image; a bad value is still rejected', () => {
    expect(menuItemUpdateSchema.parse({ description: '', imageUrl: '' })).toEqual({
      description: null,
      imageUrl: null,
    });
    expect(menuItemUpdateSchema.safeParse({ price: 0 }).success).toBe(false);
    expect(menuItemUpdateSchema.safeParse({ sortOrder: 10_000 }).success).toBe(false);
    expect(menuItemUpdateSchema.safeParse({ sortOrder: -1 }).success).toBe(false);
    expect(menuItemUpdateSchema.safeParse({ imageUrl: 'http://x.test/a.png' }).success).toBe(false);
  });
});

describe('stockBulkSchema', () => {
  it('AS3b accepts 1-100 unique items with stock 0-10000', () => {
    expect(
      stockBulkSchema.parse({
        items: [
          { menuItemId: 3, stock: 30 },
          { menuItemId: 4, stock: 0 },
        ],
      }).items,
    ).toHaveLength(2);
    expect(stockBulkSchema.safeParse({ items: [{ menuItemId: 3, stock: 10_000 }] }).success).toBe(
      true,
    );
  });

  it('AS3b rejects [], 101 items, duplicate ids, bad stock, bad ids and extra keys', () => {
    const one = (o: Record<string, unknown>) => stockBulkSchema.safeParse({ items: [o] }).success;
    expect(stockBulkSchema.safeParse({ items: [] }).success).toBe(false);
    expect(
      stockBulkSchema.safeParse({
        items: Array.from({ length: 101 }, (_, i) => ({ menuItemId: i + 1, stock: 1 })),
      }).success,
    ).toBe(false);
    expect(
      stockBulkSchema.safeParse({
        items: [
          { menuItemId: 3, stock: 1 },
          { menuItemId: 3, stock: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(one({ menuItemId: 3, stock: -1 })).toBe(false);
    expect(one({ menuItemId: 3, stock: 10_001 })).toBe(false);
    expect(one({ menuItemId: 3, stock: 1.5 })).toBe(false);
    expect(one({ menuItemId: 0, stock: 1 })).toBe(false);
    expect(one({ menuItemId: 3, stock: 1, price: 5 })).toBe(false);
    expect(stockBulkSchema.safeParse({ items: [{ menuItemId: 3, stock: 1 }], x: 1 }).success).toBe(
      false,
    );
  });
});

describe('location schemas', () => {
  it('LC1 create trims the name and rejects a short, long or unknown-key body', () => {
    expect(locationCreateSchema.parse({ name: '  Hall 5 ' })).toEqual({ name: 'Hall 5' });
    expect(locationCreateSchema.parse({ name: 'Hall 5', sortOrder: 2 })).toEqual({
      name: 'Hall 5',
      sortOrder: 2,
    });
    expect(locationCreateSchema.safeParse({ name: 'H' }).success).toBe(false);
    expect(locationCreateSchema.safeParse({ name: 'x'.repeat(41) }).success).toBe(false);
    expect(locationCreateSchema.safeParse({ name: 'Hall 5', isActive: true }).success).toBe(false);
  });

  it('LC1 update needs at least one key and is strict', () => {
    expect(locationUpdateSchema.safeParse({}).success).toBe(false);
    expect(locationUpdateSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(locationUpdateSchema.parse({ name: ' MSH ', sortOrder: 1 })).toEqual({
      name: 'MSH',
      sortOrder: 1,
    });
    expect(locationUpdateSchema.safeParse({ slotCount: 3 }).success).toBe(false);
  });
});

describe('slot schemas', () => {
  const slot = { locationId: 1, deliveryTime: '20:00', cutoffTime: '19:30' };

  it('AS4 create accepts a cutoff before the delivery time', () => {
    expect(slotCreateSchema.parse(slot)).toEqual(slot);
    expect(slotCreateSchema.parse({ ...slot, isActive: false }).isActive).toBe(false);
  });

  it('AS4 create: cutoff equal to delivery is an issue on cutoffTime with the spec message', () => {
    const r = slotCreateSchema.safeParse({ ...slot, cutoffTime: '20:00' });
    expect(r.success).toBe(false);
    expect(r.error?.issues).toHaveLength(1);
    expect(r.error?.issues[0]?.path).toEqual(['cutoffTime']);
    expect(r.error?.issues[0]?.message).toBe('Cutoff must be before the delivery time.');
    expect(slotCreateSchema.safeParse({ ...slot, cutoffTime: '21:00' }).success).toBe(false);
  });

  it('AS4 create rejects an unpadded or invalid time, a bad location id and an extra key', () => {
    const r = slotCreateSchema.safeParse({ ...slot, deliveryTime: '8:00' });
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain('deliveryTime');
    expect(issuePaths(r)).not.toContain('cutoffTime');
    expect(slotCreateSchema.safeParse({ ...slot, cutoffTime: '24:00' }).success).toBe(false);
    expect(slotCreateSchema.safeParse({ ...slot, locationId: 0 }).success).toBe(false);
    expect(slotCreateSchema.safeParse({ ...slot, closedToday: true }).success).toBe(false);
    expect(slotCreateSchema.safeParse({ ...slot, locationId: undefined }).success).toBe(false);
  });

  it('AS4 update: any subset, at least one key, no cross-field rule (the service merges)', () => {
    expect(slotUpdateSchema.safeParse({}).success).toBe(false);
    expect(slotUpdateSchema.parse({ closedToday: true })).toEqual({ closedToday: true });
    expect(slotUpdateSchema.parse({ cutoffTime: '20:30' })).toEqual({ cutoffTime: '20:30' });
    expect(slotUpdateSchema.safeParse({ deliveryTime: '8:00' }).success).toBe(false);
    expect(slotUpdateSchema.safeParse({ locationId: 2 }).success).toBe(false);
  });
});

describe('settingsUpdateSchema', () => {
  it('AS5 normalises the contact phone and turns "" into null', () => {
    expect(settingsUpdateSchema.parse({ contactPhone: '+91 98765 43210' })).toEqual({
      contactPhone: '9876543210',
    });
    expect(settingsUpdateSchema.parse({ contactPhone: '' })).toEqual({ contactPhone: null });
    expect(settingsUpdateSchema.parse({ contactPhone: null })).toEqual({ contactPhone: null });
  });

  it('AS5 rejects a bad phone and fees outside 0-500', () => {
    expect(settingsUpdateSchema.safeParse({ contactPhone: '12345' }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ expressFee: 501 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ batchFee: 501 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ batchFee: -1 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ expressFee: 12.5 }).success).toBe(false);
    expect(settingsUpdateSchema.parse({ expressFee: 500, batchFee: 0 })).toEqual({
      expressFee: 500,
      batchFee: 0,
    });
  });

  it('AS5 checks ETA minutes 1-180 and the express hours as HH:mm', () => {
    expect(settingsUpdateSchema.safeParse({ expressEtaMinMinutes: 0 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ expressEtaMaxMinutes: 181 }).success).toBe(false);
    expect(
      settingsUpdateSchema.parse({ expressEtaMinMinutes: 1, expressEtaMaxMinutes: 180 }),
    ).toEqual({ expressEtaMinMinutes: 1, expressEtaMaxMinutes: 180 });
    expect(settingsUpdateSchema.safeParse({ expressOpensAt: '9:00' }).success).toBe(false);
    expect(
      settingsUpdateSchema.parse({ expressOpensAt: '09:00', expressClosesAt: '23:30' }),
    ).toEqual({ expressOpensAt: '09:00', expressClosesAt: '23:30' });
  });

  it('AS5 takes any subset (booleans too), at least one key, and rejects unknown keys', () => {
    expect(settingsUpdateSchema.parse({ ordersPaused: true })).toEqual({ ordersPaused: true });
    expect(settingsUpdateSchema.parse({ expressEnabled: false })).toEqual({
      expressEnabled: false,
    });
    expect(settingsUpdateSchema.safeParse({}).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ id: 1 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ updatedAt: '2026-10-04T00:00:00.000Z' }).success).toBe(
      false,
    );
  });
});

describe('query schemas', () => {
  it('QS1 dashboardQuerySchema: date is optional and must be YYYY-MM-DD', () => {
    expect(dashboardQuerySchema.parse({})).toEqual({});
    expect(dashboardQuerySchema.parse({ date: '2026-10-04' })).toEqual({ date: '2026-10-04' });
    expect(dashboardQuerySchema.safeParse({ date: '2026-13-01' }).success).toBe(false);
    expect(dashboardQuerySchema.safeParse({ date: '04/10/2026' }).success).toBe(false);
    expect(dashboardQuerySchema.safeParse({ date: '2026-10-04', x: '1' }).success).toBe(false);
  });

  it('QS2 ordersQuerySchema: coerces slotId, trims q, and turns an empty q into undefined', () => {
    expect(ordersQuerySchema.parse({})).toEqual({});
    expect(
      ordersQuerySchema.parse({
        date: '2026-10-04',
        mode: 'BATCH',
        status: 'ORDER_RECEIVED',
        slotId: '7',
        q: ' 1023 ',
      }),
    ).toEqual({
      date: '2026-10-04',
      mode: 'BATCH',
      status: 'ORDER_RECEIVED',
      slotId: 7,
      q: '1023',
    });
    expect(ordersQuerySchema.parse({ q: '' }).q).toBeUndefined();
    expect(ordersQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
  });

  it('QS2 ordersQuerySchema rejects bad values and unknown keys', () => {
    expect(ordersQuerySchema.safeParse({ mode: 'PICKUP' }).success).toBe(false);
    expect(ordersQuerySchema.safeParse({ status: 'PAID' }).success).toBe(false);
    expect(ordersQuerySchema.safeParse({ slotId: '0' }).success).toBe(false);
    expect(ordersQuerySchema.safeParse({ slotId: 'abc' }).success).toBe(false);
    expect(ordersQuerySchema.safeParse({ slotId: '1.5' }).success).toBe(false);
    expect(ordersQuerySchema.safeParse({ slotId: '2147483648' }).success).toBe(false);
    expect(ordersQuerySchema.safeParse({ q: 'x'.repeat(21) }).success).toBe(false);
    expect(ordersQuerySchema.safeParse({ q: 'x'.repeat(20) }).success).toBe(true);
    expect(ordersQuerySchema.safeParse({ limit: '5' }).success).toBe(false);
  });
});

describe('pathId', () => {
  function notFound(raw: string | undefined) {
    try {
      pathId(raw);
    } catch (e) {
      return e;
    }
    return undefined;
  }

  it('AS6 parses a positive integer', () => {
    expect(pathId('57')).toBe(57);
    expect(pathId('1')).toBe(1);
    expect(pathId('2147483647')).toBe(2_147_483_647);
  });

  it('AS6 throws NOT_FOUND for 0, text, 1e3, an id above the Postgres int and undefined', () => {
    for (const raw of ['0', 'abc', '1e3', '2147483648', '-5', '1.5', ' 5', '', undefined]) {
      const e = notFound(raw);
      expect(e, String(raw)).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('NOT_FOUND');
      expect((e as AppError).status).toBe(404);
      expect((e as AppError).message).toBe('Not found.');
    }
  });

  it('AS6 rejects a 11-digit number without parsing it', () => {
    expect((notFound('12345678901') as AppError).code).toBe('NOT_FOUND');
  });
});

// ---------- response schemas ----------

// The admin order view example from Batch 1 §8.5.
const orderView = {
  id: 57,
  orderNumber: 'BB1023',
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
  addressDetail: 'Room 214, B block',
  items: [{ menuItemId: 3, name: 'Chicken Biryani', unitPrice: 150, quantity: 2, lineTotal: 300 }],
  itemCount: 2,
  foodSubtotal: 300,
  deliveryFee: 0,
  total: 300,
  createdAt: '2026-10-04T08:30:12.000Z',
  completedAt: null,
  cancelledAt: null,
  collectedAt: null,
};

const expressView = {
  ...orderView,
  id: 58,
  orderNumber: 'BB1024',
  deliveryMode: 'EXPRESS',
  slotId: null,
  slotDeliveryTime: null,
  expressWindow: { from: '19:40', to: '19:50', etaText: '30–40 minutes' },
  isLate: true,
  deliveryFee: 30,
  total: 330,
  completedAt: '2026-10-04T14:20:00.000Z',
  collectedAt: '2026-10-04T14:20:00.000Z',
};

describe('adminOrderViewSchema', () => {
  it('AS7 accepts the Batch 1 §8.5 example', () => {
    expect(adminOrderViewSchema.safeParse(orderView).success).toBe(true);
    expect(adminOrdersResponseSchema.safeParse({ orders: [orderView, expressView] }).success).toBe(
      true,
    );
    expect(adminOrdersResponseSchema.safeParse({ orders: [] }).success).toBe(true);
  });

  it('AS7 rejects the example with clientRequestId added (and any other extra key)', () => {
    expect(
      adminOrderViewSchema.safeParse({
        ...orderView,
        clientRequestId: '5b1c6f0e-4a4f-4c3e-9d0a-3b2a1f7c8d9e',
      }).success,
    ).toBe(false);
    expect(adminOrderViewSchema.safeParse({ ...orderView, updatedAt: 'x' }).success).toBe(false);
    expect(adminOrdersResponseSchema.safeParse({ orders: [orderView], total: 1 }).success).toBe(
      false,
    );
  });

  it('AS7 rejects a missing field and a bad enum value', () => {
    expect(adminOrderViewSchema.safeParse(omit(orderView, 'isLate')).success).toBe(false);
    expect(adminOrderViewSchema.safeParse({ ...orderView, status: 'PAID' }).success).toBe(false);
    expect(adminOrderViewSchema.safeParse({ ...orderView, total: 300.5 }).success).toBe(false);
    expect(
      adminOrderViewSchema.safeParse({ ...orderView, items: [{ ...orderView.items[0], x: 1 }] })
        .success,
    ).toBe(false);
  });
});

const batch = {
  slotId: 1,
  locationName: 'MSH',
  deliveryTime: '20:00',
  cutoffTime: '19:30',
  slotTimeChanged: false,
  isOpenNow: true,
  closedToday: false,
  orderCount: 4,
  openCount: 3,
  itemCount: 9,
  codTotal: 1340,
  codPending: 1040,
  itemBreakdown: [
    { menuItemId: 3, name: 'Chicken Biryani', quantity: 8 },
    { menuItemId: 4, name: 'Paneer Biryani', quantity: 1 },
  ],
  orders: [orderView],
};

// The dashboard example from Batch 1 §8.5, with the Decision 4 additions to `controls`.
const dashboard = {
  date: '2026-10-04',
  isToday: true,
  serverTime: '19:12',
  controls: {
    ordersPaused: false,
    expressEnabled: true,
    expressAvailableNow: true,
    expressOpensAt: '11:00',
    expressClosesAt: '23:00',
  },
  stock: { itemsOnMenu: 6, itemsWithoutStockToday: 2 },
  summary: {
    newOrders: 7,
    completed: 3,
    cancelled: 1,
    codPending: 2240,
    codCollected: 600,
    openOrdersFromEarlierDays: 0,
  },
  batches: [batch],
  express: { activeCount: 2, orders: [expressView] },
  earlierOpenOrders: [orderView],
};

describe('dashboardSchema', () => {
  it('DB1 accepts the Batch 1 §8.5 dashboard, with express hours in controls', () => {
    expect(dashboardBatchSchema.safeParse(batch).success).toBe(true);
    expect(dashboardSchema.safeParse(dashboard).success).toBe(true);
    expect(
      dashboardSchema.safeParse({ ...dashboard, batches: [], earlierOpenOrders: [] }).success,
    ).toBe(true);
  });

  it('DB1 rejects missing express hours, an extra key anywhere, and a leaked field in an order', () => {
    expect(
      dashboardSchema.safeParse({
        ...dashboard,
        controls: omit(dashboard.controls, 'expressOpensAt'),
      }).success,
    ).toBe(false);
    expect(
      dashboardSchema.safeParse({
        ...dashboard,
        controls: { ...dashboard.controls, expressFee: 30 },
      }).success,
    ).toBe(false);
    expect(dashboardSchema.safeParse({ ...dashboard, extra: 1 }).success).toBe(false);
    expect(
      dashboardSchema.safeParse({
        ...dashboard,
        controls: { ...dashboard.controls, expressOpensAt: '9:00' },
      }).success,
    ).toBe(false);
    expect(
      dashboardSchema.safeParse({
        ...dashboard,
        stock: { ...dashboard.stock, itemsOnMenu: undefined },
      }).success,
    ).toBe(false);
    expect(
      dashboardSchema.safeParse({
        ...dashboard,
        batches: [{ ...batch, orders: [{ ...orderView, clientRequestId: 'x' }] }],
      }).success,
    ).toBe(false);
    expect(
      dashboardSchema.safeParse({
        ...dashboard,
        express: { ...dashboard.express, orders: [{ ...expressView, secret: 1 }] },
      }).success,
    ).toBe(false);
    expect(
      dashboardBatchSchema.safeParse({
        ...batch,
        itemBreakdown: [{ menuItemId: 3, name: 'x', quantity: 1, price: 5 }],
      }).success,
    ).toBe(false);
  });
});

describe('management response schemas', () => {
  const menuItem = {
    id: 3,
    name: 'Chicken Biryani',
    description: 'Slow-cooked',
    price: 150,
    imageUrl: null,
    isAvailable: true,
    sortOrder: 0,
    dailyStock: 30,
    stockRemaining: 8,
    stockDate: '2026-10-04',
    stockSetToday: true,
    soldToday: 22,
  };

  it('MR1 adminMenuItemSchema accepts the §8.5 item, with a null stock date, and is strict', () => {
    expect(adminMenuItemSchema.safeParse(menuItem).success).toBe(true);
    expect(adminMenuResponseSchema.safeParse({ items: [menuItem] }).success).toBe(true);
    expect(
      adminMenuItemSchema.safeParse({
        ...menuItem,
        description: null,
        dailyStock: 0,
        stockRemaining: 0,
        stockDate: null,
        stockSetToday: false,
        soldToday: 0,
      }).success,
    ).toBe(true);
    expect(adminMenuItemSchema.safeParse({ ...menuItem, isActive: true }).success).toBe(false);
    expect(adminMenuItemSchema.safeParse({ ...menuItem, stockDate: '04-10-2026' }).success).toBe(
      false,
    );
    expect(adminMenuResponseSchema.safeParse({ items: [menuItem], date: 'x' }).success).toBe(false);
  });

  it('MR1 adminLocationSchema and adminSlotSchema match Batch 1 §8.5 and are strict', () => {
    const location = { id: 1, name: 'MSH', isActive: true, sortOrder: 0, slotCount: 2 };
    const slot = {
      id: 1,
      locationId: 1,
      locationName: 'MSH',
      deliveryTime: '20:00',
      cutoffTime: '19:30',
      isActive: true,
      closedToday: false,
      openOrdersToday: 3,
    };
    expect(adminLocationSchema.safeParse(location).success).toBe(true);
    expect(adminLocationSchema.safeParse({ ...location, createdAt: 'x' }).success).toBe(false);
    expect(adminSlotSchema.safeParse(slot).success).toBe(true);
    expect(adminSlotSchema.safeParse({ ...slot, closedOn: '2026-10-04' }).success).toBe(false);
    expect(adminSlotSchema.safeParse({ ...slot, deliveryTime: '8:00' }).success).toBe(false);
  });

  it('MR1 adminSettingsSchema is every DeliverySettings field except id and updatedAt', () => {
    const settings = {
      ordersPaused: false,
      expressEnabled: true,
      expressFee: 30,
      expressEtaMinMinutes: 30,
      expressEtaMaxMinutes: 40,
      expressOpensAt: '11:00',
      expressClosesAt: '23:00',
      batchFee: 0,
      contactPhone: null,
    };
    expect(adminSettingsSchema.safeParse(settings).success).toBe(true);
    expect(adminSettingsSchema.safeParse({ ...settings, contactPhone: '9876543210' }).success).toBe(
      true,
    );
    expect(adminSettingsSchema.safeParse({ ...settings, contactPhone: '12345' }).success).toBe(
      false,
    );
    expect(adminSettingsSchema.safeParse({ ...settings, id: 1 }).success).toBe(false);
    expect(
      adminSettingsSchema.safeParse({ ...settings, updatedAt: '2026-10-04T00:00:00.000Z' }).success,
    ).toBe(false);
    expect(adminSettingsSchema.safeParse(omit(settings, 'batchFee')).success).toBe(false);
  });

  it('MR1 completeManyResultSchema is { completed, collected }', () => {
    expect(completeManyResultSchema.parse({ completed: 3, collected: 3 })).toEqual({
      completed: 3,
      collected: 3,
    });
    expect(completeManyResultSchema.safeParse({ completed: 3 }).success).toBe(false);
    expect(completeManyResultSchema.safeParse({ completed: -1, collected: 0 }).success).toBe(false);
    expect(
      completeManyResultSchema.safeParse({ completed: 1, collected: 0, ids: [1] }).success,
    ).toBe(false);
  });
});
