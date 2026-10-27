import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toDbDate } from '../../src/server/lib/db-date.js';
import {
  reserveStock,
  restoreStockForOrder,
  setTodayStock,
} from '../../src/server/services/inventory.service.js';
import { makeApp } from '../helpers/app.js';
import { TEST_NOW, TEST_TODAY } from '../helpers/clock.js';
import { prisma } from '../helpers/db.js';
import { assertInventoryInvariant } from '../helpers/invariant.js';
import { setupOrderTestDb, type SetupOrderResult } from '../helpers/order-fixtures.js';

describe('Inventory service integration (Batch 5 §12.3)', () => {
  let fixtures: SetupOrderResult;
  let app: ReturnType<typeof makeApp>['app'];

  beforeEach(async () => {
    fixtures = await setupOrderTestDb(prisma, TEST_TODAY);
    app = makeApp({ now: TEST_NOW, prisma }).app;
  });

  afterEach(async () => {
    await assertInventoryInvariant(prisma);
  });

  it('R1: reserveStock atomically decrements stock_remaining and returns locked item info', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const reserved = await reserveStock(tx, TEST_TODAY, [
          { menuItemId: fixtures.items.itemA.id, quantity: 2 },
        ]);

        expect(reserved).toEqual([
          { id: fixtures.items.itemA.id, name: 'Chicken Biryani', price: 150 },
        ]);

        const itemA = await tx.menuItem.findUniqueOrThrow({
          where: { id: fixtures.items.itemA.id },
        });
        expect(itemA.stockRemaining).toBe(3);
        expect(itemA.dailyStock).toBe(5);

        // Intentionally throw to roll back so inventory invariant holds
        throw new Error('ROLLBACK_INTENTIONAL');
      }),
    ).rejects.toThrow('ROLLBACK_INTENTIONAL');

    const itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.stockRemaining).toBe(5);
  });

  it('R2: reserveStock throws OUT_OF_STOCK and rolls back if quantity exceeds available', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        return reserveStock(tx, TEST_TODAY, [
          { menuItemId: fixtures.items.itemC.id, quantity: 2 }, // only 1 in stock
        ]);
      }),
    ).rejects.toMatchObject({
      code: 'OUT_OF_STOCK',
      details: {
        items: [{ menuItemId: fixtures.items.itemC.id, available: 1 }],
      },
    });

    const itemC = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemC.id },
    });
    expect(itemC.stockRemaining).toBe(1);
  });

  it('31: New day: item stocked yesterday -> setTodayStock resets daily and remaining to new value', async () => {
    // Set item A to yesterday with daily 10, remaining 2
    await prisma.menuItem.update({
      where: { id: fixtures.items.itemA.id },
      data: {
        dailyStock: 10,
        stockRemaining: 2,
        stockDate: toDbDate('2026-10-03'),
      },
    });

    const rows = await prisma.$transaction(async (tx) => {
      return setTodayStock(tx, TEST_TODAY, [
        { menuItemId: fixtures.items.itemA.id, stock: 20 },
      ]);
    });

    expect(rows).toEqual([
      {
        id: fixtures.items.itemA.id,
        dailyStock: 20,
        stockRemaining: 20,
        stockDate: TEST_TODAY,
      },
    ]);

    const itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.dailyStock).toBe(20);
    expect(itemA.stockRemaining).toBe(20);
  });

  it('32: Same day: daily 10 with 6 sold -> adjust up, adjust to sold, and reject below sold', async () => {
    // Set daily stock 10
    await prisma.$transaction(async (tx) => {
      return setTodayStock(tx, TEST_TODAY, [
        { menuItemId: fixtures.items.itemA.id, stock: 10 },
      ]);
    });

    // Place an order for 6 Chicken Biryani (using 2 orders to not exceed single line cap 5)
    // Order 1: qty 3
    const res1 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: '11111111-1111-4111-8111-111111111111',
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Customer One',
        customerPhone: '9876543210',
        addressDetail: 'Room 101',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 3 }],
        expectedTotal: 450,
      });
    expect(res1.status).toBe(201);

    // Order 2: qty 3
    const res2 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: '22222222-2222-4222-8222-222222222222',
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Customer Two',
        customerPhone: '9876543211',
        addressDetail: 'Room 102',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 3 }],
        expectedTotal: 450,
      });
    expect(res2.status).toBe(201);

    // Now 6 sold, 4 remaining out of 10
    let itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.dailyStock).toBe(10);
    expect(itemA.stockRemaining).toBe(4);

    // Set 15 -> remaining becomes 15 - 6 = 9
    await prisma.$transaction(async (tx) => {
      return setTodayStock(tx, TEST_TODAY, [
        { menuItemId: fixtures.items.itemA.id, stock: 15 },
      ]);
    });
    itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.dailyStock).toBe(15);
    expect(itemA.stockRemaining).toBe(9);

    // Set 6 -> remaining becomes 6 - 6 = 0
    await prisma.$transaction(async (tx) => {
      return setTodayStock(tx, TEST_TODAY, [
        { menuItemId: fixtures.items.itemA.id, stock: 6 },
      ]);
    });
    itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.dailyStock).toBe(6);
    expect(itemA.stockRemaining).toBe(0);

    // Set 5 -> fails with STOCK_BELOW_SOLD, sold: 6, nothing changed
    await expect(
      prisma.$transaction(async (tx) => {
        return setTodayStock(tx, TEST_TODAY, [
          { menuItemId: fixtures.items.itemA.id, stock: 5 },
        ]);
      }),
    ).rejects.toMatchObject({
      code: 'STOCK_BELOW_SOLD',
      details: {
        items: [{ menuItemId: fixtures.items.itemA.id, sold: 6 }],
      },
    });

    itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.dailyStock).toBe(6);
    expect(itemA.stockRemaining).toBe(0);
  });

  it('33: Bulk setTodayStock: one below sold aborts all; unknown id throws NOT_FOUND', async () => {
    // Sell 1 of C
    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: '33333333-3333-4333-8333-333333333333',
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Customer C',
        customerPhone: '9876543212',
        addressDetail: 'Room 103',
        items: [{ menuItemId: fixtures.items.itemC.id, quantity: 1 }],
        expectedTotal: 20,
      });
    expect(res.status).toBe(201);

    // Try setting A to 10, B to 10, C to 0 (sold is 1)
    await expect(
      prisma.$transaction(async (tx) => {
        return setTodayStock(tx, TEST_TODAY, [
          { menuItemId: fixtures.items.itemA.id, stock: 10 },
          { menuItemId: fixtures.items.itemB.id, stock: 10 },
          { menuItemId: fixtures.items.itemC.id, stock: 0 },
        ]);
      }),
    ).rejects.toMatchObject({
      code: 'STOCK_BELOW_SOLD',
      details: {
        items: [{ menuItemId: fixtures.items.itemC.id, sold: 1 }],
      },
    });

    // Check nothing changed for A or B
    const itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.dailyStock).toBe(5);

    // Unknown id throws NOT_FOUND
    await expect(
      prisma.$transaction(async (tx) => {
        return setTodayStock(tx, TEST_TODAY, [
          { menuItemId: 9999, stock: 10 },
        ]);
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('34: restoreStockForOrder returns stock for today order, but leaves unchanged for yesterday order', async () => {
    // Place order for today: 2 of A
    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: '44444444-4444-4444-8444-444444444444',
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Customer Four',
        customerPhone: '9876543214',
        addressDetail: 'Room 104',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 2 }],
        expectedTotal: 300,
      });
    expect(res.status).toBe(201);

    let itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.stockRemaining).toBe(3);

    // Cancel order in transaction: lock row, update status to CANCELLED, restore stock
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { orderNumber: res.body.orderNumber },
        include: { items: true },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      });
      await restoreStockForOrder(tx, {
        deliveryDate: TEST_TODAY,
        items: order.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
      });
    });

    itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.stockRemaining).toBe(5);

    // Now test yesterday's order:
    // Create an order directly in DB for yesterday '2026-10-03'
    const yesterdayOrder = await prisma.order.create({
      data: {
        orderNumber: 'BB0999',
        clientRequestId: '55555555-5555-4555-8555-555555555555',
        status: 'ORDER_RECEIVED',
        paymentMethod: 'COD',
        paymentStatus: 'PENDING',
        deliveryMode: 'BATCH',
        deliveryDate: toDbDate('2026-10-03'),
        locationId: fixtures.msh.locationId,
        locationName: 'MSH',
        slotId: fixtures.msh.slotId,
        slotDeliveryTime: '20:00',
        customerName: 'Yesterday Customer',
        customerPhone: '9876543219',
        foodSubtotal: 300,
        deliveryFee: 0,
        total: 300,
        createdAt: new Date('2026-10-03T19:10:00+05:30'),
        items: {
          create: [
            {
              menuItemId: fixtures.items.itemA.id,
              itemName: 'Chicken Biryani',
              unitPrice: 150,
              quantity: 2,
              lineTotal: 300,
            },
          ],
        },
      },
      include: { items: true },
    });

    // Cancelling yesterday's order for item A (which has stock_date = '2026-10-04')
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: yesterdayOrder.id },
        data: { status: 'CANCELLED' },
      });
      const { restoredLines } = await restoreStockForOrder(tx, {
        deliveryDate: '2026-10-03',
        items: yesterdayOrder.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
      });
      expect(restoredLines).toBe(0);
    });

    itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    // Remains 5, not 7!
    expect(itemA.stockRemaining).toBe(5);
  });
});
