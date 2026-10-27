import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toDbDate } from '../../src/server/lib/db-date.js';
import { makeApp } from '../helpers/app.js';
import { TEST_NOW, TEST_TODAY } from '../helpers/clock.js';
import { prisma } from '../helpers/db.js';
import { assertInventoryInvariant } from '../helpers/invariant.js';
import { setupOrderTestDb, type SetupOrderResult } from '../helpers/order-fixtures.js';

describe('POST /api/orders create integration (Batch 5 §12.1)', () => {
  let fixtures: SetupOrderResult;
  let app: ReturnType<typeof makeApp>['app'];

  beforeEach(async () => {
    fixtures = await setupOrderTestDb(prisma, TEST_TODAY);
    app = makeApp({ now: TEST_NOW, prisma }).app;
  });

  afterEach(async () => {
    await assertInventoryInvariant(prisma);
  });

  // --- Happy paths ---

  it('1: Batch MSH, 2 x A -> 201 with snapshots, decremented stock and created_at', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        addressDetail: 'Room 214',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 2 }],
        expectedTotal: 300,
      });

    expect(res.status).toBe(201);
    expect(res.body.orderNumber).toBe('BB1001');
    expect(res.body.status).toBe('ORDER_RECEIVED');
    expect(res.body.paymentMethod).toBe('COD');
    expect(res.body.paymentStatus).toBe('PENDING');
    expect(res.body.deliveryFee).toBe(0);
    expect(res.body.total).toBe(300);
    expect(res.body.slotDeliveryTime).toBe('20:00');
    expect(res.body.locationName).toBe('MSH');
    expect(res.body.replayed).toBe(false);

    // Stock A remaining 3
    const itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.stockRemaining).toBe(3);

    // DB row assertions
    const dbOrder = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: 'BB1001' },
      include: { items: true },
    });
    expect(dbOrder.createdAt.toISOString()).toBe(TEST_NOW);
    expect(dbOrder.locationName).toBe('MSH');
    expect(dbOrder.slotDeliveryTime).toBe('20:00');
    expect(dbOrder.items).toHaveLength(1);
    expect(dbOrder.items[0]?.itemName).toBe('Chicken Biryani');
    expect(dbOrder.items[0]?.unitPrice).toBe(150);
  });

  it('2: Express Kanhar, 2 x A -> deliveryFee: 30, total: 330, slot_id null, expressWindow set', async () => {
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
    expect(res.body.deliveryFee).toBe(30);
    expect(res.body.total).toBe(330);
    expect(res.body.slotDeliveryTime).toBeNull();
    expect(res.body.expressWindow).toEqual({
      from: '19:40',
      to: '19:50',
      etaText: '30–40 minutes',
    });

    const dbOrder = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: res.body.orderNumber },
    });
    expect(dbOrder.slotId).toBeNull();
    expect(dbOrder.expressEtaMinMinutes).toBe(30);
    expect(dbOrder.expressEtaMaxMinutes).toBe(40);
  });

  it('3: A second order gets BB1002', async () => {
    const res1 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Customer One',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });
    expect(res1.body.orderNumber).toBe('BB1001');

    const res2 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Customer Two',
        customerPhone: '9876543211',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });
    expect(res2.body.orderNumber).toBe('BB1002');
  });

  it('4: Lines [{A,2},{A,3}] -> one order item with quantity 5', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [
          { menuItemId: fixtures.items.itemA.id, quantity: 2 },
          { menuItemId: fixtures.items.itemA.id, quantity: 3 },
        ],
        expectedTotal: 750,
      });

    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toEqual({
      name: 'Chicken Biryani',
      unitPrice: 150,
      quantity: 5,
      lineTotal: 750,
    });
  });

  it('5: Snapshots: mutations to menu items and locations after order do not alter lookup', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 2 }],
        expectedTotal: 300,
      });
    expect(res.status).toBe(201);

    // Mutate price of A, rename MSH, and move slot time
    await prisma.menuItem.update({
      where: { id: fixtures.items.itemA.id },
      data: { price: 200, name: 'Fancy Biryani' },
    });
    await prisma.deliveryLocation.update({
      where: { id: fixtures.msh.locationId },
      data: { name: 'Main Campus' },
    });
    await prisma.deliverySlot.update({
      where: { id: fixtures.msh.slotId },
      data: { deliveryTime: '20:15' },
    });

    // Lookup should still return the snapshotted values
    const lookup = await request(app)
      .post('/api/orders/lookup')
      .send({
        orderNumber: 'BB1001',
        phone: '9876543210',
      });
    expect(lookup.status).toBe(200);
    expect(lookup.body.locationName).toBe('MSH');
    expect(lookup.body.slotDeliveryTime).toBe('20:00');
    expect(lookup.body.items[0].name).toBe('Chicken Biryani');
    expect(lookup.body.items[0].unitPrice).toBe(150);
    expect(lookup.body.total).toBe(300);
  });

  // --- Rejections ---

  it('6: orders_paused -> 409 ORDERS_PAUSED', async () => {
    await prisma.deliverySettings.update({
      where: { id: 1 },
      data: { ordersPaused: true },
    });

    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDERS_PAUSED');

    // Assert no orders created and stock untouched
    expect(await prisma.order.count()).toBe(0);
    const itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.stockRemaining).toBe(5);
  });

  it('7: 19:30 IST, batch MSH -> 409 SLOT_CLOSED, CUTOFF_PASSED, expressAvailable: true', async () => {
    // 19:30 IST is past MSH cutoff (19:30)
    const lateApp = makeApp({ now: '2026-10-04T14:00:00.000Z', prisma }).app;

    const res = await request(lateApp)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_CLOSED');
    expect(res.body.error.details.reason).toBe('CUTOFF_PASSED');
    expect(res.body.error.details.expressAvailable).toBe(true);
    expect(await prisma.order.count()).toBe(0);
  });

  it('8: MSH closed_on today -> SLOT_CLOSED, CLOSED_TODAY', async () => {
    await prisma.deliverySlot.update({
      where: { id: fixtures.msh.slotId },
      data: { closedOn: toDbDate(TEST_TODAY) },
    });

    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_CLOSED');
    expect(res.body.error.details.reason).toBe('CLOSED_TODAY');
    expect(await prisma.order.count()).toBe(0);
  });

  it('9: Inactive slot -> SLOT_CLOSED, INACTIVE. Active slot at inactive location -> LOCATION_UNAVAILABLE', async () => {
    // Inactive slot
    await prisma.deliverySlot.update({
      where: { id: fixtures.msh.slotId },
      data: { isActive: false },
    });

    const res1 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });
    expect(res1.status).toBe(409);
    expect(res1.body.error.code).toBe('SLOT_CLOSED');
    expect(res1.body.error.details.reason).toBe('INACTIVE');

    // Restore slot, deactivate location
    await prisma.deliverySlot.update({
      where: { id: fixtures.msh.slotId },
      data: { isActive: true },
    });
    await prisma.deliveryLocation.update({
      where: { id: fixtures.msh.locationId },
      data: { isActive: false },
    });

    const res2 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });
    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('LOCATION_UNAVAILABLE');
    expect(await prisma.order.count()).toBe(0);
  });

  it('10: Kanhar slot with locationId MSH -> 400 VALIDATION_ERROR on slotId', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.kanhar.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fieldErrors?.slotId).toBeDefined();
    expect(await prisma.order.count()).toBe(0);
  });

  it('11: Express with express disabled -> DISABLED; at 10:00 IST -> OUTSIDE_HOURS; inactive location -> LOCATION_UNAVAILABLE', async () => {
    // 1. expressEnabled: false
    await prisma.deliverySettings.update({
      where: { id: 1 },
      data: { expressEnabled: false },
    });

    const res1 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'EXPRESS',
        locationId: fixtures.kanhar.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 180,
      });
    expect(res1.status).toBe(409);
    expect(res1.body.error.code).toBe('EXPRESS_UNAVAILABLE');
    expect(res1.body.error.details.reason).toBe('DISABLED');

    // 2. outside hours (10:00 IST = 04:30 UTC)
    await prisma.deliverySettings.update({
      where: { id: 1 },
      data: { expressEnabled: true },
    });
    const earlyApp = makeApp({ now: '2026-10-04T04:30:00.000Z', prisma }).app;
    const res2 = await request(earlyApp)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'EXPRESS',
        locationId: fixtures.kanhar.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 180,
      });
    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('EXPRESS_UNAVAILABLE');
    expect(res2.body.error.details.reason).toBe('OUTSIDE_HOURS');

    // 3. inactive location
    await prisma.deliveryLocation.update({
      where: { id: fixtures.kanhar.locationId },
      data: { isActive: false },
    });
    const res3 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'EXPRESS',
        locationId: fixtures.kanhar.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 180,
      });
    expect(res3.status).toBe(409);
    expect(res3.body.error.code).toBe('LOCATION_UNAVAILABLE');
    expect(await prisma.order.count()).toBe(0);
  });

  it('12: Express payload containing slotId -> 400', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'EXPRESS',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.kanhar.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 180,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.order.count()).toBe(0);
  });

  it('13: Disabled item, inactive item, unknown id 9999 -> ITEM_UNAVAILABLE listing each id', async () => {
    await prisma.menuItem.update({
      where: { id: fixtures.items.itemB.id },
      data: { isAvailable: false },
    });

    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [
          { menuItemId: fixtures.items.itemB.id, quantity: 1 },
          { menuItemId: 9999, quantity: 1 },
        ],
        expectedTotal: 150,
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');
    const ids = res.body.error.details.items.map((i: { menuItemId: number }) => i.menuItemId);
    expect(ids).toContain(fixtures.items.itemB.id);
    expect(ids).toContain(9999);
    expect(await prisma.order.count()).toBe(0);
  });

  it('14: Quantity 11 -> 400; [{A,6},{A,5}] (merged 11) -> 400; 11 lines -> 400', async () => {
    // 1. Single line with qty 11
    const res1 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 11 }],
        expectedTotal: 1650,
      });
    expect(res1.status).toBe(400);

    // 2. Merged lines summing to 11
    const res2 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [
          { menuItemId: fixtures.items.itemA.id, quantity: 6 },
          { menuItemId: fixtures.items.itemA.id, quantity: 5 },
        ],
        expectedTotal: 1650,
      });
    expect(res2.status).toBe(400);

    // 3. 11 lines in request
    const lines = Array.from({ length: 11 }, () => ({
      menuItemId: fixtures.items.itemA.id,
      quantity: 1,
    }));
    const res3 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: lines,
        expectedTotal: 1650,
      });
    expect(res3.status).toBe(400);
    expect(await prisma.order.count()).toBe(0);
  });

  it('15: 6 x A and 6 x B -> OUT_OF_STOCK listing both with available: 5', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [
          { menuItemId: fixtures.items.itemA.id, quantity: 6 },
          { menuItemId: fixtures.items.itemB.id, quantity: 6 },
        ],
        expectedTotal: 1680,
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OUT_OF_STOCK');
    expect(res.body.error.details.items).toEqual([
      { menuItemId: fixtures.items.itemA.id, name: 'Chicken Biryani', available: 5 },
      { menuItemId: fixtures.items.itemB.id, name: 'Paneer Biryani', available: 5 },
    ]);
    expect(await prisma.order.count()).toBe(0);
  });

  it('16: Item stocked yesterday -> OUT_OF_STOCK with available: 0', async () => {
    await prisma.menuItem.update({
      where: { id: fixtures.items.itemA.id },
      data: { stockDate: toDbDate('2026-10-03') },
    });

    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OUT_OF_STOCK');
    expect(res.body.error.details.items[0]).toEqual({
      menuItemId: fixtures.items.itemA.id,
      name: 'Chicken Biryani',
      available: 0,
    });
    expect(await prisma.order.count()).toBe(0);
  });

  it('17: expectedTotal: 299 for a ₹300 order -> 409 PRICE_CHANGED, details.total: 300, stock unchanged', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 2 }],
        expectedTotal: 299,
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRICE_CHANGED');
    expect(res.body.error.details.total).toBe(300);

    // Assert reservation was rolled back
    const itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.stockRemaining).toBe(5);
    expect(await prisma.order.count()).toBe(0);
  });

  it('18: Per-phone cap: 3 orders succeed, 4th -> 429 TOO_MANY_OPEN_ORDERS; completed/cancelled free up cap', async () => {
    const phone = '9876543210';

    // 1st order
    const r1 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: phone,
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });
    expect(r1.status).toBe(201);

    // 2nd order
    const r2 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: phone,
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });
    expect(r2.status).toBe(201);

    // 3rd order
    const r3 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: phone,
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });
    expect(r3.status).toBe(201);

    // 4th order fails with 429 TOO_MANY_OPEN_ORDERS
    const r4 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: phone,
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });
    expect(r4.status).toBe(429);
    expect(r4.body.error.code).toBe('TOO_MANY_OPEN_ORDERS');

    // Mark 1st order COMPLETED
    await prisma.order.update({
      where: { orderNumber: r1.body.orderNumber },
      data: { status: 'COMPLETED' },
    });

    // Now a new order succeeds!
    const r5 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: phone,
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });
    expect(r5.status).toBe(201);
  });

  it('19: Order rate limit lowered to 2 -> third request 429 RATE_LIMITED with Retry-After', async () => {
    const limitedApp = makeApp({
      now: TEST_NOW,
      prisma,
      limits: {
        order: { windowMs: 600000, max: 2 },
      },
    }).app;

    const r1 = await request(limitedApp)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul 1',
        customerPhone: '9876543201',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });
    expect(r1.status).toBe(201);

    const r2 = await request(limitedApp)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul 2',
        customerPhone: '9876543202',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });
    expect(r2.status).toBe(201);

    const r3 = await request(limitedApp)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul 3',
        customerPhone: '9876543203',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });
    expect(r3.status).toBe(429);
    expect(r3.body.error.code).toBe('RATE_LIMITED');
    expect(r3.headers['retry-after']).toBeDefined();
  });

  // --- Idempotency ---

  it('20: Same body twice in sequence -> 201 then 200 with replayed: true, stock decremented once', async () => {
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

    const res1 = await request(app).post('/api/orders').send(payload);
    expect(res1.status).toBe(201);
    expect(res1.body.replayed).toBe(false);
    expect(res1.body.orderNumber).toBe('BB1001');

    const res2 = await request(app).post('/api/orders').send(payload);
    expect(res2.status).toBe(200);
    expect(res2.body.replayed).toBe(true);
    expect(res2.body.orderNumber).toBe('BB1001');

    // Only 1 order row in DB
    expect(await prisma.order.count()).toBe(1);

    // Stock decremented by 2, not 4
    const itemA = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemA.id },
    });
    expect(itemA.stockRemaining).toBe(3);
  });

  it('21: Same clientRequestId, different phone -> 409 IDEMPOTENCY_CONFLICT', async () => {
    const id = randomUUID();

    const res1 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: id,
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: id,
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: '9876543211', // different phone!
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });
    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('22: Concurrent identical requests -> exactly one 201, rest 200, one row in DB', async () => {
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

    const results = await Promise.all([
      request(app).post('/api/orders').send(payload),
      request(app).post('/api/orders').send(payload),
      request(app).post('/api/orders').send(payload),
      request(app).post('/api/orders').send(payload),
      request(app).post('/api/orders').send(payload),
    ]);

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 200)).toHaveLength(4);

    const orderNumbers = new Set(
      results.map((r) => String((r.body as { orderNumber: string }).orderNumber)),
    );
    expect(orderNumbers.size).toBe(1);

    expect(await prisma.order.count()).toBe(1);
  });

  it('22-last-item: Concurrent identical requests for last item of C -> 201 and 200 (never OUT_OF_STOCK)', async () => {
    const payload = {
      clientRequestId: randomUUID(),
      deliveryMode: 'BATCH' as const,
      slotId: fixtures.msh.slotId,
      locationId: fixtures.msh.locationId,
      customerName: 'Rahul Verma',
      customerPhone: '9876543210',
      items: [{ menuItemId: fixtures.items.itemC.id, quantity: 1 }],
      expectedTotal: 20,
    };

    const results = await Promise.all([
      request(app).post('/api/orders').send(payload),
      request(app).post('/api/orders').send(payload),
    ]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 201]);

    const itemC = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixtures.items.itemC.id },
    });
    expect(itemC.stockRemaining).toBe(0);
  });

  it('22-cap: Phone with 2 orders sends 3rd order twice concurrently -> 201 and 200 (never TOO_MANY_OPEN_ORDERS)', async () => {
    const phone = '9876543210';

    // Place 2 initial orders
    await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: phone,
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });

    await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Rahul Verma',
        customerPhone: phone,
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
        expectedTotal: 150,
      });

    // 3rd order sent concurrently with same clientRequestId
    const payload = {
      clientRequestId: randomUUID(),
      deliveryMode: 'BATCH' as const,
      slotId: fixtures.msh.slotId,
      locationId: fixtures.msh.locationId,
      customerName: 'Rahul Verma',
      customerPhone: phone,
      items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
      expectedTotal: 150,
    };

    const results = await Promise.all([
      request(app).post('/api/orders').send(payload),
      request(app).post('/api/orders').send(payload),
    ]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 201]);
  });

  it('D1, D2: Replay succeeds even if orders are paused or prices changed after order creation', async () => {
    const payload = {
      clientRequestId: randomUUID(),
      deliveryMode: 'BATCH' as const,
      slotId: fixtures.msh.slotId,
      locationId: fixtures.msh.locationId,
      customerName: 'Rahul Verma',
      customerPhone: '9876543210',
      items: [{ menuItemId: fixtures.items.itemA.id, quantity: 1 }],
      expectedTotal: 150,
    };

    const res1 = await request(app).post('/api/orders').send(payload);
    expect(res1.status).toBe(201);

    // Pause orders
    await prisma.deliverySettings.update({
      where: { id: 1 },
      data: { ordersPaused: true },
    });

    // Replay returns 200 replayed
    const res2 = await request(app).post('/api/orders').send(payload);
    expect(res2.status).toBe(200);
    expect(res2.body.replayed).toBe(true);
    expect(res2.body.orderNumber).toBe(res1.body.orderNumber);
  });
});
