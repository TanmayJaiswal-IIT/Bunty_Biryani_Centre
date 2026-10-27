import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { silentLogger } from '../../src/server/lib/logger.js';
import { setTodayStock } from '../../src/server/services/inventory.service.js';
import { makeApp } from '../helpers/app.js';
import { createTestClock, TEST_NOW, TEST_TODAY } from '../helpers/clock.js';
import { prisma } from '../helpers/db.js';
import { assertInventoryInvariant } from '../helpers/invariant.js';
import { setupOrderTestDb, type SetupOrderResult } from '../helpers/order-fixtures.js';

describe('Order concurrency integration (Batch 5 §12.1 cases #23–25)', () => {
  let fixtures: SetupOrderResult;
  let app: ReturnType<typeof makeApp>['app'];

  beforeEach(async () => {
    fixtures = await setupOrderTestDb(prisma, TEST_TODAY);
    app = makeApp({ now: TEST_NOW, prisma }).app;
  });

  afterEach(async () => {
    await assertInventoryInvariant(prisma);
  });

  it('23: Last item of C (1 left) ordered by 2 different customers concurrently -> one 201, one 409 OUT_OF_STOCK, C remaining 0', async () => {
    const req1 = {
      clientRequestId: randomUUID(),
      deliveryMode: 'BATCH' as const,
      slotId: fixtures.msh.slotId,
      locationId: fixtures.msh.locationId,
      customerName: 'Customer One',
      customerPhone: '9876543201',
      items: [{ menuItemId: fixtures.items.itemC.id, quantity: 1 }],
      expectedTotal: 20,
    };

    const req2 = {
      clientRequestId: randomUUID(),
      deliveryMode: 'BATCH' as const,
      slotId: fixtures.msh.slotId,
      locationId: fixtures.msh.locationId,
      customerName: 'Customer Two',
      customerPhone: '9876543202',
      items: [{ menuItemId: fixtures.items.itemC.id, quantity: 1 }],
      expectedTotal: 20,
    };

    const results = await Promise.all([
      request(app).post('/api/orders').send(req1),
      request(app).post('/api/orders').send(req2),
    ]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);

    const success = results.find((r) => r.status === 201)!;
    expect(success.body.orderNumber).toBeDefined();

    const failure = results.find((r) => r.status === 409)!;
    expect(failure.body.error.code).toBe('OUT_OF_STOCK');
    expect(failure.body.error.details.items[0]).toEqual({
      menuItemId: fixtures.items.itemC.id,
      name: 'Raita',
      available: 0,
    });

    const itemC = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemC.id },
    });
    expect(itemC.stockRemaining).toBe(0);
  });

  it('24: Ten concurrent orders of 1 x A with 5 in stock -> exactly 5 succeed (201), 5 get OUT_OF_STOCK (409), A remaining 0', async () => {
    const requests = Array.from({ length: 10 }, (_, i) => ({
      clientRequestId: randomUUID(),
      deliveryMode: 'BATCH' as const,
      slotId: fixtures.msh.slotId,
      locationId: fixtures.msh.locationId,
      customerName: `Customer ${i + 1}`,
      customerPhone: `98765432${i < 10 ? '0' + i : i}`,
      items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
      expectedTotal: 150,
    }));

    const results = await Promise.all(
      requests.map((r) => request(app).post('/api/orders').send(r)),
    );

    const statuses = results.map((r) => r.status);
    const successes = statuses.filter((s) => s === 201);
    const outOfStocks = statuses.filter((s) => s === 409);

    expect(successes).toHaveLength(5);
    expect(outOfStocks).toHaveLength(5);

    // Verify all 409s were OUT_OF_STOCK
    for (const r of results.filter((res) => res.status === 409)) {
      expect(r.body.error.code).toBe('OUT_OF_STOCK');
      expect(r.body.error.details.items[0]?.available).toBe(0);
    }

    const itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.stockRemaining).toBe(0);
  });

  it('25: Lock order: 20 concurrent alternating [A,B] and [B,A] -> all succeed without deadlocks or order.retry warning', async () => {
    // Increase stock of A and B to 20
    await prisma.$transaction(async (tx) => {
      await setTodayStock(tx, TEST_TODAY, [
        { menuItemId: fixtures.items.itemA.id, stock: 20 },
        { menuItemId: fixtures.items.itemB.id, stock: 20 },
      ]);
    });

    const warnSpy = vi.fn();
    const customLogger = {
      ...silentLogger,
      warn: warnSpy,
    };

    const { app: trackedApp } = {
      app: createApp({
        prisma,
        clock: createTestClock(TEST_NOW),
        config: makeApp().config,
        logger: customLogger,
      }),
    };

    // 20 requests alternating between lines [A, B] and [B, A]
    const requests = Array.from({ length: 20 }, (_, i) => {
      const isEven = i % 2 === 0;
      const lines = isEven
        ? [
            { menuItemId: fixtures.items.itemA.id, quantity: 1 },
            { menuItemId: fixtures.items.itemB.id, quantity: 1 },
          ]
        : [
            { menuItemId: fixtures.items.itemB.id, quantity: 1 },
            { menuItemId: fixtures.items.itemA.id, quantity: 1 },
          ];

      return {
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH' as const,
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: `Customer ${i + 1}`,
        customerPhone: `98765400${i < 10 ? '0' + i : i}`,
        items: lines,
        expectedTotal: 280, // ₹150 + ₹130
      };
    });

    const results = await Promise.all(
      requests.map((r) => request(trackedApp).post('/api/orders').send(r)),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 201)).toBe(true);

    // Verify no retry was needed because sorting prevented deadlocks!
    const retryCalls = warnSpy.mock.calls.filter((call) => call[0] === 'order.retry');
    expect(retryCalls).toHaveLength(0);

    const itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    const itemB = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemB.id },
    });
    expect(itemA.stockRemaining).toBe(0);
    expect(itemB.stockRemaining).toBe(0);
  });

  it('26-c: Concurrent mixed quantities: 2 customers order 2 x A with 3 in stock -> one 201, one 409 available 1', async () => {
    // Set item A to daily 3, remaining 3
    await prisma.$transaction(async (tx) => {
      await setTodayStock(tx, TEST_TODAY, [
        { menuItemId: fixtures.items.itemA.id, stock: 3 },
      ]);
    });

    const req1 = {
      clientRequestId: randomUUID(),
      deliveryMode: 'BATCH' as const,
      slotId: fixtures.msh.slotId,
      locationId: fixtures.msh.locationId,
      customerName: 'Customer One',
      customerPhone: '9876543201',
      items: [{ menuItemId: fixtures.items.itemA.id, quantity: 2 }],
      expectedTotal: 300,
    };

    const req2 = {
      clientRequestId: randomUUID(),
      deliveryMode: 'BATCH' as const,
      slotId: fixtures.msh.slotId,
      locationId: fixtures.msh.locationId,
      customerName: 'Customer Two',
      customerPhone: '9876543202',
      items: [{ menuItemId: fixtures.items.itemA.id, quantity: 2 }],
      expectedTotal: 300,
    };

    const results = await Promise.all([
      request(app).post('/api/orders').send(req1),
      request(app).post('/api/orders').send(req2),
    ]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);

    const failed = results.find((r) => r.status === 409)!;
    expect(failed.body.error.code).toBe('OUT_OF_STOCK');
    expect(failed.body.error.details.items[0]?.available).toBe(1);

    const itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.stockRemaining).toBe(1);
  });

  it('27-c: Concurrent multi-item: 4 customers order [A, C] with C stock: 2, A stock: 5 -> exactly 2 succeed', async () => {
    // C has 2 stock
    await prisma.$transaction(async (tx) => {
      await setTodayStock(tx, TEST_TODAY, [
        { menuItemId: fixtures.items.itemC.id, stock: 2 },
      ]);
    });

    const requests = Array.from({ length: 4 }, (_, i) => ({
      clientRequestId: randomUUID(),
      deliveryMode: 'BATCH' as const,
      slotId: fixtures.msh.slotId,
      locationId: fixtures.msh.locationId,
      customerName: `Customer ${i + 1}`,
      customerPhone: `98765433${i < 10 ? '0' + i : i}`,
      items: [
        { menuItemId: fixtures.items.itemA.id, quantity: 1 },
        { menuItemId: fixtures.items.itemC.id, quantity: 1 },
      ],
      expectedTotal: 170,
    }));

    const results = await Promise.all(
      requests.map((r) => request(app).post('/api/orders').send(r)),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(2);
    expect(statuses.filter((s) => s === 409)).toHaveLength(2);

    for (const r of results.filter((res) => res.status === 409)) {
      expect(r.body.error.code).toBe('OUT_OF_STOCK');
      expect(r.body.error.details.items.some((i: { menuItemId: number }) => i.menuItemId === fixtures.items.itemC.id)).toBe(true);
    }

    const itemC = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemC.id },
    });
    const itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemC.stockRemaining).toBe(0);
    expect(itemA.stockRemaining).toBe(3);
  });

  it('28-c: High concurrency under heavy stock contention (12 requests for 2 stock)', async () => {
    // C has 2 stock
    await prisma.$transaction(async (tx) => {
      await setTodayStock(tx, TEST_TODAY, [
        { menuItemId: fixtures.items.itemC.id, stock: 2 },
      ]);
    });

    const requests = Array.from({ length: 12 }, (_, i) => ({
      clientRequestId: randomUUID(),
      deliveryMode: 'BATCH' as const,
      slotId: fixtures.msh.slotId,
      locationId: fixtures.msh.locationId,
      customerName: `Contender ${i + 1}`,
      customerPhone: `98765444${i < 10 ? '0' + i : i}`,
      items: [{ menuItemId: fixtures.items.itemC.id, quantity: 1 }],
      expectedTotal: 20,
    }));

    const results = await Promise.all(
      requests.map((r) => request(app).post('/api/orders').send(r)),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(2);
    expect(statuses.filter((s) => s === 409)).toHaveLength(10);

    const itemC = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemC.id },
    });
    expect(itemC.stockRemaining).toBe(0);
  });

  it('29-c: Replay concurrency: identical request submitted concurrently 8 times -> one 201, seven 200', async () => {
    const payload = {
      clientRequestId: randomUUID(),
      deliveryMode: 'BATCH' as const,
      slotId: fixtures.msh.slotId,
      locationId: fixtures.msh.locationId,
      customerName: 'Rahul Verma',
      customerPhone: '9876543210',
      items: [{ menuItemId: fixtures.items.itemA.id, quantity: 2 }],
      expectedTotal: 300,
    };

    const results = await Promise.all(
      Array.from({ length: 8 }, () => request(app).post('/api/orders').send(payload)),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 200)).toHaveLength(7);

    const orderNumbers = new Set(
      results.map((r) => String((r.body as { orderNumber: string }).orderNumber)),
    );
    expect(orderNumbers.size).toBe(1);

    expect(await prisma.order.count()).toBe(1);

    const itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.stockRemaining).toBe(3);
  });

  it('30-c: Concurrent 3-item permutation locks [A, B, C] and [C, B, A] -> all 10 succeed', async () => {
    await prisma.$transaction(async (tx) => {
      await setTodayStock(tx, TEST_TODAY, [
        { menuItemId: fixtures.items.itemA.id, stock: 10 },
        { menuItemId: fixtures.items.itemB.id, stock: 10 },
        { menuItemId: fixtures.items.itemC.id, stock: 10 },
      ]);
    });

    const requests = Array.from({ length: 10 }, (_, i) => {
      const reversed = i % 2 !== 0;
      const lines = reversed
        ? [
            { menuItemId: fixtures.items.itemC.id, quantity: 1 },
            { menuItemId: fixtures.items.itemB.id, quantity: 1 },
            { menuItemId: fixtures.items.itemA.id, quantity: 1 },
          ]
        : [
            { menuItemId: fixtures.items.itemA.id, quantity: 1 },
            { menuItemId: fixtures.items.itemB.id, quantity: 1 },
            { menuItemId: fixtures.items.itemC.id, quantity: 1 },
          ];

      return {
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH' as const,
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: `Cust ${i + 1}`,
        customerPhone: `98765455${i < 10 ? '0' + i : i}`,
        items: lines,
        expectedTotal: 300,
      };
    });

    const results = await Promise.all(
      requests.map((r) => request(app).post('/api/orders').send(r)),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 201)).toBe(true);
  });

  it('31-c: Concurrency across batch and express orders accessing the same item stock', async () => {
    // 6 concurrent orders: 3 BATCH and 3 EXPRESS for item A (stock: 5)
    const requests = Array.from({ length: 6 }, (_, i) => {
      const isExpress = i % 2 !== 0;
      return {
        clientRequestId: randomUUID(),
        deliveryMode: isExpress ? ('EXPRESS' as const) : ('BATCH' as const),
        slotId: isExpress ? undefined : fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: `Customer ${i + 1}`,
        customerPhone: `98765466${i < 10 ? '0' + i : i}`,
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: isExpress ? 180 : 150,
      };
    });

    const results = await Promise.all(
      requests.map((r) => request(app).post('/api/orders').send(r)),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);

    const itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.stockRemaining).toBe(0);
  });

  it('32-c: Concurrency with open orders cap: multiple customers each submitting concurrently near their cap', async () => {
    // Customer 1 and Customer 2 both submit 2 orders concurrently
    const phone1 = '9876543201';
    const phone2 = '9876543202';

    const reqs = [
      {
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH' as const,
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Customer 1',
        customerPhone: phone1,
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      },
      {
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH' as const,
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Customer 1',
        customerPhone: phone1,
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      },
      {
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH' as const,
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Customer 2',
        customerPhone: phone2,
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      },
      {
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH' as const,
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Customer 2',
        customerPhone: phone2,
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      },
    ];

    const results = await Promise.all(
      reqs.map((r) => request(app).post('/api/orders').send(r)),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 201)).toBe(true);
    expect(await prisma.order.count({ where: { customerPhone: phone1 } })).toBe(2);
    expect(await prisma.order.count({ where: { customerPhone: phone2 } })).toBe(2);
  });

  it('33-c: Concurrency with order placement and cancellation in parallel maintaining inventory balance', async () => {
    // Place an initial order
    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Customer Early',
        customerPhone: '9876543209',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });
    expect(res.status).toBe(201);
    const orderNumber = res.body.orderNumber as string;

    // Concurrently: Place a new order for item A, and cancel the previous order for item A
    const placeNew = request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Customer Late',
        customerPhone: '9876543208',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });

    const cancelOld = prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { orderNumber },
        include: { items: true },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      });
      const { restoreStockForOrder } = await import(
        '../../src/server/services/inventory.service.js'
      );
      await restoreStockForOrder(tx, {
        deliveryDate: TEST_TODAY,
        items: order.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
      });
    });

    const [placeRes] = await Promise.all([placeNew, cancelOld]);
    expect(placeRes.status).toBe(201);

    // Stock started at 5, -1 +1 -1 = 4 remaining
    const itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.stockRemaining).toBe(4);
  });
});
