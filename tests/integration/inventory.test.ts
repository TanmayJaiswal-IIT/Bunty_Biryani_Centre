import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { fromDbDate } from '../../src/server/lib/db-date';
import {
  reserveStock,
  restoreStockForOrder,
  setTodayStock,
  type StockLine,
} from '../../src/server/services/inventory.service';
import { makeApp } from '../helpers/app';
import { istInstant, TEST_NOW, TEST_TODAY } from '../helpers/clock';
import { prisma } from '../helpers/db';
import { createMenuItem } from '../helpers/factories';
import { expectInventoryInvariant } from '../helpers/invariant';
import { batchBody, seedOrderWorld, type OrderWorld } from '../helpers/order-fixtures';

afterEach(expectInventoryInvariant);

const ROLLBACK = new Error('rollback on purpose');

async function stockOf(id: number) {
  const row = await prisma.menuItem.findUniqueOrThrow({ where: { id } });
  return { dailyStock: row.dailyStock, stockRemaining: row.stockRemaining };
}

/** "Sold" through a real batch order via POST /api/orders (clock 19:10 IST on `now`'s day). */
async function sellViaApi(
  w: OrderWorld,
  lines: StockLine[],
  options: { now?: string; expectedTotal?: number } = {},
) {
  const { app } = makeApp({ now: options.now });
  const over = options.expectedTotal === undefined ? {} : { expectedTotal: options.expectedTotal };
  const res = await request(app)
    .post('/api/orders')
    .send(batchBody(w, lines, over));
  expect(res.status, res.text).toBe(201);
  return prisma.order.findUniqueOrThrow({
    where: { orderNumber: res.body.orderNumber as string },
    include: { items: true },
  });
}

/** Cancel the way Batch 6's status machine will: lock the order row, mark it, restore stock. */
function cancelOrder(order: Awaited<ReturnType<typeof sellViaApi>>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(TEST_NOW) },
    });
    return restoreStockForOrder(tx, {
      deliveryDate: fromDbDate(order.deliveryDate),
      items: order.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
    });
  });
}

describe('reserveStock', () => {
  it('R1 decrements in ascending id order, returns name and price, and rolls back with the transaction', async () => {
    const w = await seedOrderWorld();

    await expect(
      prisma.$transaction(async (tx) => {
        const reserved = await reserveStock(tx, TEST_TODAY, [
          { menuItemId: w.B.id, quantity: 1 },
          { menuItemId: w.A.id, quantity: 2 },
        ]);
        expect(reserved).toEqual([
          { id: w.A.id, name: 'Chicken Biryani', price: 150 },
          { id: w.B.id, name: 'Paneer Biryani', price: 130 },
        ]);
        const a = await tx.menuItem.findUniqueOrThrow({ where: { id: w.A.id } });
        const b = await tx.menuItem.findUniqueOrThrow({ where: { id: w.B.id } });
        expect([a.stockRemaining, b.stockRemaining]).toEqual([3, 4]);
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);

    expect((await stockOf(w.A.id)).stockRemaining).toBe(5);
    expect((await stockOf(w.B.id)).stockRemaining).toBe(5);
  });

  it('R2 rejects OUT_OF_STOCK with the available count for short, other-day and disabled items', async () => {
    const w = await seedOrderWorld();
    const yesterday = await createMenuItem({
      name: 'Old stock',
      stock: 4,
      stockDate: '2026-10-03',
    });
    const disabled = await createMenuItem({ name: 'Off menu', stock: 4, isAvailable: false });

    const attempt = (lines: StockLine[]) =>
      prisma.$transaction((tx) => reserveStock(tx, TEST_TODAY, lines));

    await expect(attempt([{ menuItemId: w.A.id, quantity: 6 }])).rejects.toMatchObject({
      code: 'OUT_OF_STOCK',
      details: { items: [{ menuItemId: w.A.id, name: 'Chicken Biryani', available: 5 }] },
    });
    await expect(attempt([{ menuItemId: yesterday.id, quantity: 1 }])).rejects.toMatchObject({
      code: 'OUT_OF_STOCK',
      details: { items: [{ menuItemId: yesterday.id, name: 'Old stock', available: 0 }] },
    });
    await expect(attempt([{ menuItemId: disabled.id, quantity: 1 }])).rejects.toMatchObject({
      code: 'OUT_OF_STOCK',
      details: { items: [{ menuItemId: disabled.id, name: 'Off menu', available: 0 }] },
    });
  });
});

describe('setTodayStock', () => {
  it('#31 the first set on a new day sets daily and remaining to the new number', async () => {
    const item = await createMenuItem({ stock: 10, stockDate: '2026-10-03' });
    await prisma.menuItem.update({ where: { id: item.id }, data: { stockRemaining: 2 } });

    const rows = await prisma.$transaction((tx) =>
      setTodayStock(tx, TEST_TODAY, [{ menuItemId: item.id, stock: 20 }]),
    );

    expect(rows).toEqual([
      { id: item.id, dailyStock: 20, stockRemaining: 20, stockDate: '2026-10-04' },
    ]);
    expect(await stockOf(item.id)).toEqual({ dailyStock: 20, stockRemaining: 20 });
  });

  it('#31 a change on the same day keeps what was already sold out of the remaining count', async () => {
    const w = await seedOrderWorld();
    await sellViaApi(w, [{ menuItemId: w.A.id, quantity: 3 }]); // daily 5, remaining 2

    await prisma.$transaction((tx) =>
      setTodayStock(tx, TEST_TODAY, [{ menuItemId: w.A.id, stock: 8 }]),
    );

    expect(await stockOf(w.A.id)).toEqual({ dailyStock: 8, stockRemaining: 5 });
  });

  it('#32 same day with 6 sold through real orders: 15 → 9 left, 6 → 0 left, 5 is below sold', async () => {
    const w = await seedOrderWorld({ stock: { A: 10 } });
    await sellViaApi(w, [{ menuItemId: w.A.id, quantity: 6 }]);
    expect(await stockOf(w.A.id)).toEqual({ dailyStock: 10, stockRemaining: 4 });

    const set = (stock: number) =>
      prisma.$transaction((tx) => setTodayStock(tx, TEST_TODAY, [{ menuItemId: w.A.id, stock }]));

    await set(15);
    expect(await stockOf(w.A.id)).toEqual({ dailyStock: 15, stockRemaining: 9 });
    await set(6);
    expect(await stockOf(w.A.id)).toEqual({ dailyStock: 6, stockRemaining: 0 });
    await expect(set(5)).rejects.toMatchObject({
      code: 'STOCK_BELOW_SOLD',
      details: { items: [{ menuItemId: w.A.id, sold: 6 }] },
    });
    expect(await stockOf(w.A.id)).toEqual({ dailyStock: 6, stockRemaining: 0 });
  });

  it('#33 a below-sold entry fails the whole batch and changes nothing', async () => {
    const w = await seedOrderWorld();
    await sellViaApi(w, [{ menuItemId: w.A.id, quantity: 3 }]); // daily 5, remaining 2, sold 3
    const before = [await stockOf(w.A.id), await stockOf(w.B.id), await stockOf(w.C.id)];

    await expect(
      prisma.$transaction((tx) =>
        setTodayStock(tx, TEST_TODAY, [
          { menuItemId: w.C.id, stock: 9 },
          { menuItemId: w.A.id, stock: 2 }, // below the 3 sold
          { menuItemId: w.B.id, stock: 9 },
        ]),
      ),
    ).rejects.toMatchObject({
      code: 'STOCK_BELOW_SOLD',
      details: { items: [{ menuItemId: w.A.id, sold: 3 }] },
    });

    expect([await stockOf(w.A.id), await stockOf(w.B.id), await stockOf(w.C.id)]).toEqual(before);
  });

  it('#33 an unknown id is NOT_FOUND, and STOCK_BELOW_SOLD takes precedence over it', async () => {
    const w = await seedOrderWorld();
    await sellViaApi(w, [{ menuItemId: w.A.id, quantity: 3 }]);

    await expect(
      prisma.$transaction((tx) => setTodayStock(tx, TEST_TODAY, [{ menuItemId: 9999, stock: 5 }])),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', details: { items: [{ menuItemId: 9999 }] } });

    await expect(
      prisma.$transaction((tx) =>
        setTodayStock(tx, TEST_TODAY, [
          { menuItemId: w.A.id, stock: 2 },
          { menuItemId: 9999, stock: 5 },
        ]),
      ),
    ).rejects.toMatchObject({
      code: 'STOCK_BELOW_SOLD',
      details: { items: [{ menuItemId: w.A.id, sold: 3 }] },
    });
  });

  it('treats a deleted (inactive) item as NOT_FOUND', async () => {
    const item = await createMenuItem({ isActive: false });
    await expect(
      prisma.$transaction((tx) =>
        setTodayStock(tx, TEST_TODAY, [{ menuItemId: item.id, stock: 5 }]),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', details: { items: [{ menuItemId: item.id }] } });
  });

  it('rejects a duplicate id or an invalid stock number as a programmer error', async () => {
    const w = await seedOrderWorld();
    const run = (entries: { menuItemId: number; stock: number }[]) =>
      prisma.$transaction((tx) => setTodayStock(tx, TEST_TODAY, entries));
    await expect(
      run([
        { menuItemId: w.A.id, stock: 1 },
        { menuItemId: w.A.id, stock: 2 },
      ]),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(run([{ menuItemId: w.A.id, stock: -1 }])).rejects.toBeInstanceOf(RangeError);
    await expect(run([{ menuItemId: w.A.id, stock: 1.5 }])).rejects.toBeInstanceOf(RangeError);
  });
});

describe('restoreStockForOrder', () => {
  it("#34 cancelling today's order returns its stock", async () => {
    const w = await seedOrderWorld();
    const order = await sellViaApi(w, [{ menuItemId: w.A.id, quantity: 2 }]);
    expect((await stockOf(w.A.id)).stockRemaining).toBe(3);

    expect(await cancelOrder(order)).toEqual({ restoredLines: 1 });

    expect(await stockOf(w.A.id)).toEqual({ dailyStock: 5, stockRemaining: 5 });
  });

  it("#34 cancelling yesterday's order leaves today's stock of that item alone", async () => {
    const w = await seedOrderWorld();
    const item = await createMenuItem({
      name: 'Mutton Biryani',
      price: 200,
      stock: 5,
      stockDate: '2026-10-03',
    });
    const order = await sellViaApi(w, [{ menuItemId: item.id, quantity: 2 }], {
      now: istInstant('19:10', '2026-10-03'),
      expectedTotal: 400,
    });
    expect(fromDbDate(order.deliveryDate)).toBe('2026-10-03');

    await prisma.$transaction((tx) =>
      setTodayStock(tx, '2026-10-04', [{ menuItemId: item.id, stock: 20 }]),
    );

    expect(await cancelOrder(order)).toEqual({ restoredLines: 0 });
    expect(await stockOf(item.id)).toEqual({ dailyStock: 20, stockRemaining: 20 });
  });
});
