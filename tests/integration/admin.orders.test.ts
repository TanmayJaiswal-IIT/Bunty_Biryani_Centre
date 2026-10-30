import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setTodayStock } from '../../src/server/services/inventory.service.js';
import {
  adminOrdersResponseSchema,
  adminOrderViewSchema,
  completeManyResultSchema,
} from '../../src/shared/schemas/admin-views.js';
import { makeApp } from '../helpers/app.js';
import { TEST_NOW, TEST_TODAY } from '../helpers/clock.js';
import { prisma } from '../helpers/db.js';
import { createAdmin } from '../helpers/factories.js';
import { adminClient, type AdminClient } from '../helpers/http.js';
import { assertInventoryInvariant } from '../helpers/invariant.js';
import { setupOrderTestDb, type SetupOrderResult } from '../helpers/order-fixtures.js';

describe('Admin orders integration (Batch 6 Task 2)', () => {
  let fixtures: SetupOrderResult;
  let app: Express;
  let admin: AdminClient;
  let appClock: ReturnType<typeof makeApp>['clock'];

  beforeEach(async () => {
    await createAdmin();
    fixtures = await setupOrderTestDb(prisma, TEST_TODAY);
    const appResult = makeApp({ now: TEST_NOW, prisma });
    app = appResult.app;
    appClock = appResult.clock;
    admin = await adminClient(app);
  });

  afterEach(async () => {
    await assertInventoryInvariant(prisma);
  });

  let phoneCounter = 10;
  function nextPhone() {
    phoneCounter += 1;
    return `98765432${String(phoneCounter).padStart(2, '0')}`;
  }

  async function placeBatchOrder(
    lines: { menuItemId: number; quantity: number }[] = [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
    phone: string = nextPhone(),
  ) {
    const total = lines.reduce((sum, l) => {
      const price = l.menuItemId === fixtures.items.itemA.id ? 150 : l.menuItemId === fixtures.items.itemB.id ? 130 : 20;
      return sum + price * l.quantity;
    }, 0);

    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: phone,
        addressDetail: 'Room 214',
        items: lines,
        expectedTotal: total,
      });
    expect(res.status).toBe(201);
    const dbOrder = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: res.body.orderNumber as string },
    });
    return dbOrder;
  }

  async function placeExpressOrder() {
    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'EXPRESS',
        locationId: fixtures.kanhar.locationId,
        customerName: 'Aman Singh',
        customerPhone: '9876543211',
        addressDetail: 'Block B',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 2 }],
        expectedTotal: 330,
      });
    expect(res.status).toBe(201);
    const dbOrder = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: res.body.orderNumber as string },
    });
    return dbOrder;
  }

  it('#16: complete -> completedAt set, reopen -> null; collect -> collectedAt set, undo -> null; no-ops', async () => {
    const order = await placeBatchOrder();

    // 1. Complete
    const resComplete = await admin.send('patch', `/api/admin/orders/${order.id}/status`, {
      status: 'COMPLETED',
    });
    expect(resComplete.status).toBe(200);
    const parsedComplete = adminOrderViewSchema.parse(resComplete.body);
    expect(parsedComplete.status).toBe('COMPLETED');
    expect(parsedComplete.completedAt).toBe(TEST_NOW);

    // Repeated complete is a no-op 200
    const resCompleteRepeat = await admin.send('patch', `/api/admin/orders/${order.id}/status`, {
      status: 'COMPLETED',
    });
    expect(resCompleteRepeat.status).toBe(200);
    expect(resCompleteRepeat.body.status).toBe('COMPLETED');
    expect(resCompleteRepeat.body.completedAt).toBe(TEST_NOW);

    // 2. Reopen
    const resReopen = await admin.send('patch', `/api/admin/orders/${order.id}/status`, {
      status: 'ORDER_RECEIVED',
    });
    expect(resReopen.status).toBe(200);
    const parsedReopen = adminOrderViewSchema.parse(resReopen.body);
    expect(parsedReopen.status).toBe('ORDER_RECEIVED');
    expect(parsedReopen.completedAt).toBeNull();

    // 3. Collect cash
    const resCollect = await admin.send('patch', `/api/admin/orders/${order.id}/status`, {
      paymentStatus: 'COLLECTED',
    });
    expect(resCollect.status).toBe(200);
    const parsedCollect = adminOrderViewSchema.parse(resCollect.body);
    expect(parsedCollect.paymentStatus).toBe('COLLECTED');
    expect(parsedCollect.collectedAt).toBe(TEST_NOW);

    // Repeated collect is a no-op 200
    const resCollectRepeat = await admin.send('patch', `/api/admin/orders/${order.id}/status`, {
      paymentStatus: 'COLLECTED',
    });
    expect(resCollectRepeat.status).toBe(200);
    expect(resCollectRepeat.body.paymentStatus).toBe('COLLECTED');

    // 4. Undo cash collection
    const resUndo = await admin.send('patch', `/api/admin/orders/${order.id}/status`, {
      paymentStatus: 'PENDING',
    });
    expect(resUndo.status).toBe(200);
    const parsedUndo = adminOrderViewSchema.parse(resUndo.body);
    expect(parsedUndo.paymentStatus).toBe('PENDING');
    expect(parsedUndo.collectedAt).toBeNull();
  });

  it('#17: order 2 x A (A 5 -> 3), cancel -> CANCELLED, stock restored to 5, GET /api/menu shows maxQty 5', async () => {
    const order = await placeBatchOrder([{ menuItemId: fixtures.items.itemA.id, quantity: 2 }]);

    const itemBefore = await prisma.menuItem.findUniqueOrThrow({ where: { id: fixtures.items.itemA.id } });
    expect(itemBefore.stockRemaining).toBe(3);

    const resCancel = await admin.send('patch', `/api/admin/orders/${order.id}/status`, {
      status: 'CANCELLED',
    });
    expect(resCancel.status).toBe(200);
    const parsed = adminOrderViewSchema.parse(resCancel.body);
    expect(parsed.status).toBe('CANCELLED');
    expect(parsed.cancelledAt).toBe(TEST_NOW);

    const itemAfter = await prisma.menuItem.findUniqueOrThrow({ where: { id: fixtures.items.itemA.id } });
    expect(itemAfter.stockRemaining).toBe(5);

    const menuRes = await request(app).get('/api/menu');
    expect(menuRes.status).toBe(200);
    const itemInMenu = (menuRes.body.items as { id: number; maxQty: number }[]).find(
      (i) => i.id === fixtures.items.itemA.id,
    );
    expect(itemInMenu?.maxQty).toBe(5);
  });

  it('#18: collect then cancel -> 409 INVALID_TRANSITION; actions on cancelled order -> 409', async () => {
    const order = await placeBatchOrder();

    // Collect first
    await admin.send('patch', `/api/admin/orders/${order.id}/status`, {
      paymentStatus: 'COLLECTED',
    });

    // Try to cancel
    const resFailCancel = await admin.send('patch', `/api/admin/orders/${order.id}/status`, {
      status: 'CANCELLED',
    });
    expect(resFailCancel.status).toBe(409);
    expect(resFailCancel.body.error.code).toBe('INVALID_TRANSITION');
    expect(resFailCancel.body.error.message).toBe('Undo cash collected before cancelling.');
    expect(resFailCancel.body.error.details).toEqual({ from: 'COLLECTED', to: 'CANCELLED' });

    // Undo collection, then cancel successfully
    await admin.send('patch', `/api/admin/orders/${order.id}/status`, {
      paymentStatus: 'PENDING',
    });
    const resCancel = await admin.send('patch', `/api/admin/orders/${order.id}/status`, {
      status: 'CANCELLED',
    });
    expect(resCancel.status).toBe(200);

    // Try complete on cancelled order -> 409
    const resComplete = await admin.send('patch', `/api/admin/orders/${order.id}/status`, {
      status: 'COMPLETED',
    });
    expect(resComplete.status).toBe(409);
    expect(resComplete.body.error.code).toBe('INVALID_TRANSITION');
    expect(resComplete.body.error.message).toBe('This order was cancelled.');

    // Try collect on cancelled order -> 409
    const resCollect = await admin.send('patch', `/api/admin/orders/${order.id}/status`, {
      paymentStatus: 'COLLECTED',
    });
    expect(resCollect.status).toBe(409);
    expect(resCollect.body.error.code).toBe('INVALID_TRANSITION');
    expect(resCollect.body.error.message).toBe('This order was cancelled.');

    // Try reopen on cancelled order -> 409
    const resReopen = await admin.send('patch', `/api/admin/orders/${order.id}/status`, {
      status: 'ORDER_RECEIVED',
    });
    expect(resReopen.status).toBe(409);
    expect(resReopen.body.error.code).toBe('INVALID_TRANSITION');
    expect(resReopen.body.error.message).toBe('This order was cancelled.');
  });

  it('#19: cancel twice in sequence -> second 200, stock restored once; concurrent cancels -> both 200, stock 5', async () => {
    // Sequential cancels
    const orderSeq = await placeBatchOrder([{ menuItemId: fixtures.items.itemA.id, quantity: 2 }]);
    const cancel1 = await admin.send('patch', `/api/admin/orders/${orderSeq.id}/status`, {
      status: 'CANCELLED',
    });
    expect(cancel1.status).toBe(200);
    const cancel2 = await admin.send('patch', `/api/admin/orders/${orderSeq.id}/status`, {
      status: 'CANCELLED',
    });
    expect(cancel2.status).toBe(200);

    let itemA = await prisma.menuItem.findUniqueOrThrow({ where: { id: fixtures.items.itemA.id } });
    expect(itemA.stockRemaining).toBe(5);

    // Concurrent cancels
    const orderConc = await placeBatchOrder([{ menuItemId: fixtures.items.itemA.id, quantity: 2 }]);
    const [cRes1, cRes2] = await Promise.all([
      admin.send('patch', `/api/admin/orders/${orderConc.id}/status`, { status: 'CANCELLED' }),
      admin.send('patch', `/api/admin/orders/${orderConc.id}/status`, { status: 'CANCELLED' }),
    ]);
    expect(cRes1.status).toBe(200);
    expect(cRes2.status).toBe(200);

    itemA = await prisma.menuItem.findUniqueOrThrow({ where: { id: fixtures.items.itemA.id } });
    expect(itemA.stockRemaining).toBe(5);
  });

  it('#20: cancelling yesterday order after today stock is set does not change today stock', async () => {
    // 1. Place order on 2026-10-03 at 19:10 IST
    appClock.set('2026-10-03T13:40:00.000Z');
    await prisma.$transaction(async (tx) => {
      await setTodayStock(tx, '2026-10-03', [{ menuItemId: fixtures.items.itemA.id, stock: 10 }]);
    });

    const resOrder = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Yesterday Customer',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 2 }],
        expectedTotal: 300,
      });
    expect(resOrder.status).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: resOrder.body.orderNumber as string },
    });

    // 2. Advance clock to today and set today's stock to 20
    appClock.set(TEST_NOW);
    await prisma.$transaction(async (tx) => {
      await setTodayStock(tx, TEST_TODAY, [{ menuItemId: fixtures.items.itemA.id, stock: 20 }]);
    });

    let itemA = await prisma.menuItem.findUniqueOrThrow({ where: { id: fixtures.items.itemA.id } });
    expect(itemA.stockRemaining).toBe(20);

    // 3. Cancel yesterday's order
    const cancelRes = await admin.send('patch', `/api/admin/orders/${order.id}/status`, {
      status: 'CANCELLED',
    });
    expect(cancelRes.status).toBe(200);

    itemA = await prisma.menuItem.findUniqueOrThrow({ where: { id: fixtures.items.itemA.id } });
    expect(itemA.stockRemaining).toBe(20);
  });

  it('#21: complete-many batch operations and rollback guarantees', async () => {
    const o1 = await placeBatchOrder();
    const o2 = await placeBatchOrder();
    const o3 = await placeBatchOrder();
    const o4 = await placeBatchOrder();

    // complete-many on three ids with markCollected: true
    const res1 = await admin.send('post', '/api/admin/orders/complete-many', {
      orderIds: [o1.id, o2.id, o3.id],
      markCollected: true,
    });
    expect(res1.status).toBe(200);
    const parsedResult = completeManyResultSchema.parse(res1.body);
    expect(parsedResult).toEqual({ completed: 3, collected: 3 });

    // o4 remains untouched
    const o4Db = await prisma.order.findUniqueOrThrow({ where: { id: o4.id } });
    expect(o4Db.status).toBe('ORDER_RECEIVED');
    expect(o4Db.paymentStatus).toBe('PENDING');

    // Unknown id -> 404 and nothing changes
    const res404 = await admin.send('post', '/api/admin/orders/complete-many', {
      orderIds: [o4.id, 999999],
      markCollected: true,
    });
    expect(res404.status).toBe(404);
    const o4Check = await prisma.order.findUniqueOrThrow({ where: { id: o4.id } });
    expect(o4Check.status).toBe('ORDER_RECEIVED');

    // Cancelled id in list -> 409 and nothing changes
    await admin.send('patch', `/api/admin/orders/${o4.id}/status`, { status: 'CANCELLED' });
    const res409 = await admin.send('post', '/api/admin/orders/complete-many', {
      orderIds: [o4.id],
      markCollected: false,
    });
    expect(res409.status).toBe(409);

    // Already completed ids -> counted as 0
    const resRepeat = await admin.send('post', '/api/admin/orders/complete-many', {
      orderIds: [o1.id, o2.id],
      markCollected: true,
    });
    expect(resRepeat.status).toBe(200);
    expect(resRepeat.body).toEqual({ completed: 0, collected: 0 });
  });

  it('AO1: invalid path id, strict PATCH body, and express admin order view details', async () => {
    // Invalid path ids
    const resAbc = await admin.get('/api/admin/orders/abc');
    expect(resAbc.status).toBe(404);

    const resOutOfRange = await admin.get('/api/admin/orders/2147483648');
    expect(resOutOfRange.status).toBe(404);

    const order = await placeExpressOrder();

    // PATCH with both keys -> 400
    const resBoth = await admin.send('patch', `/api/admin/orders/${order.id}/status`, {
      status: 'COMPLETED',
      paymentStatus: 'COLLECTED',
    });
    expect(resBoth.status).toBe(400);

    // Express order view
    const resView = await admin.get(`/api/admin/orders/${order.id}`);
    expect(resView.status).toBe(200);
    const parsed = adminOrderViewSchema.parse(resView.body);
    expect(parsed.expressWindow).toEqual({
      from: '19:40',
      to: '19:50',
      etaText: '30–40 minutes',
    });
    expect(parsed.isLate).toBe(false);
  });

  it('OC1 (Review Focus 2): concurrent cancel and new order for last stock item C', async () => {
    // Stock of C is 1. Order 1 x C.
    const resC = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Initial C Buyer',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemC.id, quantity: 1 }],
        expectedTotal: 20,
      });
    expect(resC.status).toBe(201);
    const existingOrder = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: resC.body.orderNumber as string },
    });

    // Concurrently: cancel that order AND place a new order for 1 x C from another phone
    const [cancelRes, newOrderRes] = await Promise.all([
      admin.send('patch', `/api/admin/orders/${existingOrder.id}/status`, { status: 'CANCELLED' }),
      request(app)
        .post('/api/orders')
        .send({
          clientRequestId: randomUUID(),
          deliveryMode: 'BATCH',
          slotId: fixtures.msh.slotId,
          locationId: fixtures.msh.locationId,
          customerName: 'Racer for C',
          customerPhone: '9876543299',
          items: [{ menuItemId: fixtures.items.itemC.id, quantity: 1 }],
          expectedTotal: 20,
        }),
    ]);

    expect(cancelRes.status).toBe(200);
    // New order must either succeed (201) if cancel finished first, or fail (409 OUT_OF_STOCK)
    expect([201, 409]).toContain(newOrderRes.status);

    // Final C remaining = 1 - (number of non-cancelled C orders)
    const activeOrders = await prisma.order.count({
      where: {
        status: { not: 'CANCELLED' },
        items: { some: { menuItemId: fixtures.items.itemC.id } },
      },
    });
    const itemC = await prisma.menuItem.findUniqueOrThrow({ where: { id: fixtures.items.itemC.id } });
    expect(itemC.stockRemaining).toBe(1 - activeOrders);
  });

  it('#22: search q, filtering by mode and status, and newest-first ordering', async () => {
    // 1. Place order 1: Batch on MSH with phone ending in 43211
    const o1 = await placeBatchOrder(
      [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
      '9876543211',
    );
    // 2. Place order 2: Express on Kanhar
    const o2 = await placeExpressOrder();
    // Cancel o2
    await admin.send('patch', `/api/admin/orders/${o2.id}/status`, { status: 'CANCELLED' });

    // q=BB1001 finds o1
    const resQ1 = await admin.get(`/api/admin/orders?q=${o1.orderNumber}`);
    expect(resQ1.status).toBe(200);
    const parsedQ1 = adminOrdersResponseSchema.parse(resQ1.body);
    expect(parsedQ1.orders.map((o) => o.orderNumber)).toContain(o1.orderNumber);

    // q=1001 finds o1 even with date set to yesterday
    const digits = o1.orderNumber.slice(2);
    const resQ2 = await admin.get(`/api/admin/orders?q=${digits}&date=2026-10-03`);
    expect(resQ2.status).toBe(200);
    const parsedQ2 = adminOrdersResponseSchema.parse(resQ2.body);
    expect(parsedQ2.orders.map((o) => o.orderNumber)).toContain(o1.orderNumber);

    // q=<last 5 digits of phone> (43211) finds o1
    const resQPhone = await admin.get('/api/admin/orders?q=43211');
    expect(resQPhone.status).toBe(200);
    const parsedQPhone = adminOrdersResponseSchema.parse(resQPhone.body);
    expect(parsedQPhone.orders.map((o) => o.orderNumber)).toContain(o1.orderNumber);

    // mode=EXPRESS and status=CANCELLED filter correctly
    const resFilter = await admin.get('/api/admin/orders?mode=EXPRESS&status=CANCELLED');
    expect(resFilter.status).toBe(200);
    const parsedFilter = adminOrdersResponseSchema.parse(resFilter.body);
    expect(parsedFilter.orders.map((o) => o.orderNumber)).toEqual([o2.orderNumber]);

    // q=Rahul -> empty orders list
    const resName = await admin.get('/api/admin/orders?q=Rahul');
    expect(resName.status).toBe(200);
    expect(resName.body).toEqual({ orders: [] });

    // Results are newest first (createdAt desc, id desc)
    const resList = await admin.get('/api/admin/orders');
    expect(resList.status).toBe(200);
    const parsedList = adminOrdersResponseSchema.parse(resList.body);
    expect(parsedList.orders[0]?.id).toBeGreaterThan(parsedList.orders[1]?.id ?? 0);
  });
});
