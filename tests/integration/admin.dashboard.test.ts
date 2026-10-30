import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toDbDate } from '../../src/server/lib/db-date.js';
import { setTodayStock } from '../../src/server/services/inventory.service.js';
import { dashboardSchema } from '../../src/shared/schemas/admin-views.js';
import {
  istInstant,
  placeOrders,
} from '../helpers/admin-fixtures.js';
import { makeApp } from '../helpers/app.js';
import { TEST_NOW, TEST_TODAY, type TestClock } from '../helpers/clock.js';
import { prisma } from '../helpers/db.js';
import { createAdmin } from '../helpers/factories.js';
import { adminClient, type AdminClient } from '../helpers/http.js';
import { assertInventoryInvariant } from '../helpers/invariant.js';
import { setupOrderTestDb, type SetupOrderResult } from '../helpers/order-fixtures.js';

describe('Admin dashboard integration (Batch 6 Task 3)', () => {
  let fixtures: SetupOrderResult;
  let app: Express;
  let admin: AdminClient;
  let clock: TestClock;

  beforeEach(async () => {
    await createAdmin();
    fixtures = await setupOrderTestDb(prisma, TEST_TODAY);
    const appResult = makeApp({ now: TEST_NOW, prisma });
    app = appResult.app;
    clock = appResult.clock;
    admin = await adminClient(app);
  });

  afterEach(async () => {
    await assertInventoryInvariant(prisma);
  });

  it('#6: multiple batch orders on MSH -> grouped into one batch with correct counts', async () => {
    await placeOrders(
      app,
      fixtures,
      [
        { at: '14:00', mode: 'BATCH', location: 'msh', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }] },
        { at: '17:00', mode: 'BATCH', location: 'msh', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }] },
        { at: '18:30', mode: 'BATCH', location: 'msh', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }] },
      ],
      clock,
    );

    clock.set(TEST_NOW);
    const res = await admin.get('/api/admin/dashboard');
    expect(res.status).toBe(200);
    const dashboard = dashboardSchema.parse(res.body);

    const mshBatch = dashboard.batches.find((b) => b.slotId === fixtures.msh.slotId);
    expect(mshBatch).toBeDefined();
    expect(mshBatch?.orderCount).toBe(3);
    expect(mshBatch?.itemCount).toBe(3);
    expect(mshBatch?.codTotal).toBe(450);
    expect(mshBatch?.orders).toHaveLength(3);
  });

  it('#7: full scenario matching brief numbers: 7 new orders, breakdown, completed orders', async () => {
    // Stock A at 20, set B's price to 140
    await prisma.$transaction(async (tx) => {
      await setTodayStock(tx, TEST_TODAY, [{ menuItemId: fixtures.items.itemA.id, stock: 20 }]);
    });
    await prisma.menuItem.update({
      where: { id: fixtures.items.itemB.id },
      data: { price: 140 },
    });
    fixtures.items.itemB.price = 140;

    // Place 4 MSH orders: [2A], [2A], [2A], [2A + 1B]
    const mshOrders = await placeOrders(
      app,
      fixtures,
      [
        { at: '16:00', mode: 'BATCH', location: 'msh', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 2 }] },
        { at: '16:30', mode: 'BATCH', location: 'msh', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 2 }] },
        { at: '17:00', mode: 'BATCH', location: 'msh', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 2 }] },
        {
          at: '17:30',
          mode: 'BATCH',
          location: 'msh',
          items: [
            { menuItemId: fixtures.items.itemA.id, quantity: 2 },
            { menuItemId: fixtures.items.itemB.id, quantity: 1 },
          ],
        },
      ],
      clock,
    );

    // Complete and collect first MSH order
    const firstMshId = (await prisma.order.findUniqueOrThrow({ where: { orderNumber: mshOrders[0]!.orderNumber } })).id;
    await admin.send('patch', `/api/admin/orders/${firstMshId}/status`, { status: 'COMPLETED' });
    await admin.send('patch', `/api/admin/orders/${firstMshId}/status`, { paymentStatus: 'COLLECTED' });

    // Place 3 Kanhar orders of [2A]
    const kanharOrders = await placeOrders(
      app,
      fixtures,
      [
        { at: '18:00', mode: 'BATCH', location: 'kanhar', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 2 }] },
        { at: '18:15', mode: 'BATCH', location: 'kanhar', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 2 }] },
        { at: '18:30', mode: 'BATCH', location: 'kanhar', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 2 }] },
      ],
      clock,
    );
    // Complete 1 Kanhar order
    const kanharId = (await prisma.order.findUniqueOrThrow({ where: { orderNumber: kanharOrders[0]!.orderNumber } })).id;
    await admin.send('patch', `/api/admin/orders/${kanharId}/status`, { status: 'COMPLETED' });

    // Place 2 express orders of [1A] (Kanhar)
    await placeOrders(
      app,
      fixtures,
      [
        { at: '18:45', mode: 'EXPRESS', location: 'kanhar', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }] },
        { at: '19:00', mode: 'EXPRESS', location: 'kanhar', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }] },
      ],
      clock,
    );

    clock.set(TEST_NOW);
    const res = await admin.get('/api/admin/dashboard');
    expect(res.status).toBe(200);
    const dash = dashboardSchema.parse(res.body);

    const msh = dash.batches.find((b) => b.slotId === fixtures.msh.slotId)!;
    expect(msh.orderCount).toBe(4);
    expect(msh.openCount).toBe(3);
    expect(msh.itemCount).toBe(9);
    expect(msh.codTotal).toBe(1340);
    expect(msh.codPending).toBe(1040);
    expect(msh.itemBreakdown).toEqual([
      { menuItemId: fixtures.items.itemA.id, name: 'Chicken Biryani', quantity: 8 },
      { menuItemId: fixtures.items.itemB.id, name: 'Paneer Biryani', quantity: 1 },
    ]);

    // Summary new orders = 3 open MSH + 2 open Kanhar + 2 open Express = 7
    expect(dash.summary.newOrders).toBe(7);
    expect(dash.express.activeCount).toBe(2);
  });

  it('#10: express isLate transitions based on clock against etaMax', async () => {
    // Express order placed at 19:10 (eta 30–40 min -> window 19:40 to 19:50)
    await placeOrders(
      app,
      fixtures,
      [{ at: '19:10', mode: 'EXPRESS', location: 'kanhar', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }] }],
      clock,
    );

    // Check at 19:45 -> isLate false
    clock.set(istInstant('19:45'));
    const res1 = await admin.get('/api/admin/dashboard');
    expect(res1.status).toBe(200);
    const dash1 = dashboardSchema.parse(res1.body);
    expect(dash1.express.orders[0]?.isLate).toBe(false);

    // Check at 19:51 -> isLate true
    clock.set(istInstant('19:51'));
    const res2 = await admin.get('/api/admin/dashboard');
    expect(res2.status).toBe(200);
    const dash2 = dashboardSchema.parse(res2.body);
    expect(dash2.express.orders[0]?.isLate).toBe(true);
  });

  it('#11: active express and batch orders from earlier days appear in dashboard', async () => {
    // 1. Set stock for 2026-10-03, place an express order and a batch order yesterday (2026-10-03)
    await prisma.$transaction(async (tx) => {
      await setTodayStock(tx, '2026-10-03', [{ menuItemId: fixtures.items.itemA.id, stock: 10 }]);
    });

    await placeOrders(
      app,
      fixtures,
      [
        { at: '19:10', date: '2026-10-03', mode: 'EXPRESS', location: 'kanhar', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }] },
        { at: '19:15', date: '2026-10-03', mode: 'BATCH', location: 'msh', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }] },
      ],
      clock,
    );

    // 2. Advance clock to today and stock today
    clock.set(TEST_NOW);
    await prisma.$transaction(async (tx) => {
      await setTodayStock(tx, TEST_TODAY, [{ menuItemId: fixtures.items.itemA.id, stock: 10 }]);
    });
    const res = await admin.get('/api/admin/dashboard');
    expect(res.status).toBe(200);
    const dash = dashboardSchema.parse(res.body);

    // Yesterday's express order is included in today's express list
    expect(dash.express.orders).toHaveLength(1);
    expect(dash.express.activeCount).toBe(1);

    // Yesterday's batch order is in earlierOpenOrders
    expect(dash.earlierOpenOrders).toHaveLength(1);
    expect(dash.summary.openOrdersFromEarlierDays).toBe(1);
  });

  it('#12: slot time changed mid-day produces two distinct batch groups', async () => {
    // Place two MSH orders at original 20:00 time
    await placeOrders(
      app,
      fixtures,
      [
        { at: '17:00', mode: 'BATCH', location: 'msh', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }] },
        { at: '17:30', mode: 'BATCH', location: 'msh', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }] },
      ],
      clock,
    );

    // Update slot in DB to 20:15
    await prisma.$executeRaw`
      UPDATE delivery_slots
         SET delivery_time = '20:15',
             cutoff_time   = '19:45'
       WHERE id = ${fixtures.msh.slotId}
    `;

    // Place 3rd order (now receives new snapshot 20:15)
    await placeOrders(
      app,
      fixtures,
      [
        { at: '18:00', mode: 'BATCH', location: 'msh', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }] },
      ],
      clock,
    );

    clock.set(TEST_NOW);
    const res = await admin.get('/api/admin/dashboard');
    expect(res.status).toBe(200);
    const dash = dashboardSchema.parse(res.body);

    const mshBatches = dash.batches.filter((b) => b.slotId === fixtures.msh.slotId);
    expect(mshBatches).toHaveLength(2);

    const oldBatch = mshBatches.find((b) => b.deliveryTime === '20:00')!;
    expect(oldBatch.slotTimeChanged).toBe(true);
    expect(oldBatch.orderCount).toBe(2);

    const newBatch = mshBatches.find((b) => b.deliveryTime === '20:15')!;
    expect(newBatch.slotTimeChanged).toBe(false);
    expect(newBatch.orderCount).toBe(1);
  });

  it('#13: itemsWithoutStockToday counts active items missing today stock', async () => {
    // A stocked today
    // B stocked yesterday (2026-10-03)
    await prisma.menuItem.update({
      where: { id: fixtures.items.itemB.id },
      data: { stockDate: toDbDate('2026-10-03') },
    });
    // C never stocked (stockDate null)
    await prisma.menuItem.update({
      where: { id: fixtures.items.itemC.id },
      data: { stockDate: null },
    });

    clock.set(TEST_NOW);
    const res = await admin.get('/api/admin/dashboard');
    expect(res.status).toBe(200);
    const dash = dashboardSchema.parse(res.body);

    expect(dash.stock.itemsWithoutStockToday).toBe(2);
  });

  it('#14: past date dashboard shows only groups with orders and empty earlierOpenOrders', async () => {
    // Set stock for 2026-10-03, then place order on 2026-10-03
    await prisma.$transaction(async (tx) => {
      await setTodayStock(tx, '2026-10-03', [{ menuItemId: fixtures.items.itemA.id, stock: 10 }]);
    });

    await placeOrders(
      app,
      fixtures,
      [{ at: '19:10', date: '2026-10-03', mode: 'BATCH', location: 'msh', items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }] }],
      clock,
    );

    clock.set(TEST_NOW);
    const res = await admin.get('/api/admin/dashboard?date=2026-10-03');
    expect(res.status).toBe(200);
    const dash = dashboardSchema.parse(res.body);

    expect(dash.isToday).toBe(false);
    expect(dash.date).toBe('2026-10-03');
    expect(dash.earlierOpenOrders).toEqual([]);
    expect(dash.batches).toHaveLength(1);
    expect(dash.batches[0]?.slotId).toBe(fixtures.msh.slotId);
  });

  it('#15: validation: future date, invalid date, and unknown query keys return 400', async () => {
    const resFuture = await admin.get('/api/admin/dashboard?date=2026-10-05');
    expect(resFuture.status).toBe(400);

    const resGarbage = await admin.get('/api/admin/dashboard?date=garbage');
    expect(resGarbage.status).toBe(400);

    const resExtraKey = await admin.get('/api/admin/dashboard?foo=1');
    expect(resExtraKey.status).toBe(400);
  });

  it('DB1: controls reflect express hours and availability', async () => {
    await prisma.deliverySettings.update({
      where: { id: 1 },
      data: { expressEnabled: false },
    });

    clock.set(TEST_NOW);
    const res = await admin.get('/api/admin/dashboard');
    expect(res.status).toBe(200);
    const dash = dashboardSchema.parse(res.body);

    expect(dash.controls.expressOpensAt).toBe('11:00');
    expect(dash.controls.expressClosesAt).toBe('23:00');
    expect(dash.controls.expressEnabled).toBe(false);
    expect(dash.controls.expressAvailableNow).toBe(false);
  });
});
