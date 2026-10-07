import type { Express } from 'express';
import request, { type Response } from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toDbDate } from '../../src/server/lib/db-date';
import type { CreateOrderResponse } from '../../src/shared/api-types';
import { createOrderResponseSchema, publicOrderViewSchema } from '../../src/shared/schemas/order';
import { captureLogger, makeApp } from '../helpers/app';
import { istInstant, TEST_NOW } from '../helpers/clock';
import { prisma } from '../helpers/db';
import { createMenuItem, createOrderRow } from '../helpers/factories';
import { expectInventoryInvariant } from '../helpers/invariant';
import { batchBody, expressBody, seedOrderWorld, type OrderWorld } from '../helpers/order-fixtures';

let w: OrderWorld;

beforeEach(async () => {
  w = await seedOrderWorld();
});

afterEach(expectInventoryInvariant);

function post(app: Express, body: Record<string, unknown>) {
  return request(app).post('/api/orders').send(body);
}

/** Every success body must pass the strict response schema (no id, no phone). */
function parsed(res: Response): CreateOrderResponse {
  return createOrderResponseSchema.parse(res.body);
}

async function placed(app: Express, body: Record<string, unknown>): Promise<CreateOrderResponse> {
  const res = await post(app, body);
  expect(res.status, res.text).toBe(201);
  return parsed(res);
}

async function stock() {
  const rows = await prisma.menuItem.findMany({
    where: { id: { in: [w.A.id, w.B.id, w.C.id] } },
  });
  const by = new Map(rows.map((r) => [r.id, r.stockRemaining]));
  return { A: by.get(w.A.id), B: by.get(w.B.id), C: by.get(w.C.id) };
}

const FRESH = { A: 5, B: 5, C: 1 };

/** A rejection: the status and code, no new order row and no stock change. */
async function expectRejected(
  res: Response,
  status: number,
  code: string,
  before: { orders: number; stock: Awaited<ReturnType<typeof stock>> } = {
    orders: 0,
    stock: FRESH,
  },
) {
  expect(res.status, res.text).toBe(status);
  expect(res.body.error.code).toBe(code);
  expect(await prisma.order.count()).toBe(before.orders);
  expect(await stock()).toEqual(before.stock);
  return res.body.error as { code: string; message: string; details?: Record<string, unknown> };
}

describe('POST /api/orders — happy paths', () => {
  it('#1 places a batch MSH order with server prices, the COD defaults and snapshots', async () => {
    await prisma.deliverySettings.update({
      where: { id: 1 },
      data: { contactPhone: '9123456780' },
    });
    const { app } = makeApp();
    const body = batchBody(w, [{ menuItemId: w.A.id, quantity: 2 }], {
      customerPhone: '+91 98765 43210',
    });

    const order = await placed(app, body);

    expect(order).toEqual({
      orderNumber: 'BB1001',
      replayed: false,
      status: 'ORDER_RECEIVED',
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      deliveryMode: 'BATCH',
      deliveryDate: '2026-10-04',
      locationName: 'MSH',
      slotDeliveryTime: '20:00',
      expressWindow: null,
      customerName: 'Rahul Verma',
      addressDetail: 'Room 214, B block',
      items: [{ name: 'Chicken Biryani', unitPrice: 150, quantity: 2, lineTotal: 300 }],
      foodSubtotal: 300,
      deliveryFee: 0,
      total: 300,
      createdAt: TEST_NOW,
      contactPhone: '9123456780',
    });
    expect((await stock()).A).toBe(3);

    const row = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: 'BB1001' },
      include: { items: true },
    });
    expect(row).toMatchObject({
      clientRequestId: body.clientRequestId,
      customerPhone: '9876543210',
      deliveryMode: 'BATCH',
      deliveryDate: toDbDate('2026-10-04'),
      locationId: w.msh.id,
      locationName: 'MSH',
      slotId: w.mshSlot.id,
      slotDeliveryTime: '20:00',
      expressEtaMinMinutes: null,
      expressEtaMaxMinutes: null,
      createdAt: new Date(TEST_NOW),
    });
    expect(row.items).toEqual([
      expect.objectContaining({
        menuItemId: w.A.id,
        itemName: 'Chicken Biryani',
        unitPrice: 150,
        quantity: 2,
        lineTotal: 300,
      }),
    ]);
  });

  it('#2 places an express Kanhar order with the fee, no slot and the ETA snapshotted', async () => {
    const { app } = makeApp();
    const order = await placed(app, expressBody(w, [{ menuItemId: w.A.id, quantity: 2 }]));

    expect(order).toMatchObject({
      deliveryMode: 'EXPRESS',
      locationName: 'Kanhar',
      slotDeliveryTime: null,
      expressWindow: { from: '19:40', to: '19:50', etaText: '30–40 minutes' },
      foodSubtotal: 300,
      deliveryFee: 30,
      total: 330,
    });
    const row = await prisma.order.findUniqueOrThrow({ where: { orderNumber: order.orderNumber } });
    expect(row).toMatchObject({
      locationId: w.kanhar.id,
      slotId: null,
      slotDeliveryTime: null,
      expressEtaMinMinutes: 30,
      expressEtaMaxMinutes: 40,
      createdAt: new Date(TEST_NOW),
    });
  });

  it('#3 gives the second order BB1002', async () => {
    const { app } = makeApp();
    const first = await placed(app, batchBody(w, [{ menuItemId: w.A.id, quantity: 1 }]));
    const second = await placed(app, batchBody(w, [{ menuItemId: w.B.id, quantity: 1 }]));
    expect([first.orderNumber, second.orderNumber]).toEqual(['BB1001', 'BB1002']);
  });

  it('#4 merges duplicate lines into one order item', async () => {
    const { app } = makeApp();
    const order = await placed(
      app,
      batchBody(w, [
        { menuItemId: w.A.id, quantity: 2 },
        { menuItemId: w.A.id, quantity: 3 },
      ]),
    );
    expect(order.items).toEqual([
      { name: 'Chicken Biryani', unitPrice: 150, quantity: 5, lineTotal: 750 },
    ]);
    expect(await prisma.orderItem.count()).toBe(1);
    expect((await stock()).A).toBe(0);
  });

  it('#4 keeps the cart order: each merged item stays at its first position', async () => {
    const { app } = makeApp();
    const order = await placed(
      app,
      batchBody(w, [
        { menuItemId: w.B.id, quantity: 1 },
        { menuItemId: w.A.id, quantity: 2 },
        { menuItemId: w.B.id, quantity: 1 },
      ]),
    );
    expect(order.items.map((i) => [i.name, i.quantity])).toEqual([
      ['Paneer Biryani', 2],
      ['Chicken Biryani', 2],
    ]);
    expect(order.total).toBe(560);
    expect(await stock()).toEqual({ A: 3, B: 3, C: 1 });
  });

  it('#5 keeps the snapshots when the price, the location name and the slot time change', async () => {
    const { app } = makeApp();
    const body = batchBody(w, [{ menuItemId: w.A.id, quantity: 2 }]);
    await placed(app, body);

    await prisma.menuItem.update({ where: { id: w.A.id }, data: { price: 175 } });
    await prisma.deliveryLocation.update({ where: { id: w.msh.id }, data: { name: 'MSH Hostel' } });
    await prisma.deliverySlot.update({
      where: { id: w.mshSlot.id },
      data: { deliveryTime: '20:15' },
    });

    const found = await request(app)
      .post('/api/orders/lookup')
      .send({ orderNumber: 'BB1001', phone: '9876543210' });
    expect(found.status, found.text).toBe(200);
    expect(publicOrderViewSchema.parse(found.body)).toMatchObject({
      locationName: 'MSH',
      slotDeliveryTime: '20:00',
      items: [{ name: 'Chicken Biryani', unitPrice: 150, quantity: 2, lineTotal: 300 }],
      total: 300,
    });

    // The replay is built from the stored order too.
    const res = await post(app, body);
    expect(res.status).toBe(200);
    expect(parsed(res)).toMatchObject({
      locationName: 'MSH',
      slotDeliveryTime: '20:00',
      items: [{ name: 'Chicken Biryani', unitPrice: 150, quantity: 2, lineTotal: 300 }],
      total: 300,
    });
    const row = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: 'BB1001' },
      include: { items: true },
    });
    expect(row).toMatchObject({ locationName: 'MSH', slotDeliveryTime: '20:00', total: 300 });
    expect(row.items[0]).toMatchObject({ itemName: 'Chicken Biryani', unitPrice: 150 });
  });
});

describe('POST /api/orders — rejections', () => {
  it('#6 rejects every order while orders are paused', async () => {
    await prisma.deliverySettings.update({ where: { id: 1 }, data: { ordersPaused: true } });
    const { app } = makeApp();
    const lines = [{ menuItemId: w.A.id, quantity: 1 }];

    await expectRejected(await post(app, batchBody(w, lines)), 409, 'ORDERS_PAUSED');
    const error = await expectRejected(
      await post(app, expressBody(w, lines)),
      409,
      'ORDERS_PAUSED',
    );
    expect(error.message).toBe('Orders are temporarily paused. Please check again shortly.');
  });

  it('#7 closes the MSH slot at its 19:30 cutoff and says whether express is open', async () => {
    const { app } = makeApp({ now: istInstant('19:30') });
    const body = () => batchBody(w, [{ menuItemId: w.A.id, quantity: 1 }]);

    const error = await expectRejected(await post(app, body()), 409, 'SLOT_CLOSED');
    expect(error.details).toEqual({ reason: 'CUTOFF_PASSED', expressAvailable: true });
    expect(error.message).toBe('Orders for this delivery slot are closed.');

    await prisma.deliverySettings.update({ where: { id: 1 }, data: { expressEnabled: false } });
    const off = await expectRejected(await post(app, body()), 409, 'SLOT_CLOSED');
    expect(off.details).toEqual({ reason: 'CUTOFF_PASSED', expressAvailable: false });
  });

  it('#8 rejects a slot the vendor closed for today', async () => {
    await prisma.deliverySlot.update({
      where: { id: w.mshSlot.id },
      data: { closedOn: toDbDate('2026-10-04') },
    });
    const { app } = makeApp();
    const error = await expectRejected(
      await post(app, batchBody(w, [{ menuItemId: w.A.id, quantity: 1 }])),
      409,
      'SLOT_CLOSED',
    );
    expect(error.details).toEqual({ reason: 'CLOSED_TODAY', expressAvailable: true });
  });

  it('#9 rejects an inactive slot as SLOT_CLOSED INACTIVE', async () => {
    await prisma.deliverySlot.update({ where: { id: w.mshSlot.id }, data: { isActive: false } });
    const { app } = makeApp();
    const error = await expectRejected(
      await post(app, batchBody(w, [{ menuItemId: w.A.id, quantity: 1 }])),
      409,
      'SLOT_CLOSED',
    );
    expect(error.details).toEqual({ reason: 'INACTIVE', expressAvailable: true });
  });

  it('#9 rejects an active slot at an inactive location as LOCATION_UNAVAILABLE', async () => {
    await prisma.deliveryLocation.update({ where: { id: w.msh.id }, data: { isActive: false } });
    const { app } = makeApp();
    const error = await expectRejected(
      await post(app, batchBody(w, [{ menuItemId: w.A.id, quantity: 1 }])),
      409,
      'LOCATION_UNAVAILABLE',
    );
    expect(error.message).toBe(
      "Delivery to this location isn't available right now. Please choose another.",
    );
  });

  it("#10 rejects Kanhar's slot sent with MSH, and an unknown slot, as VALIDATION_ERROR on slotId", async () => {
    const { app } = makeApp();
    const lines = [{ menuItemId: w.A.id, quantity: 1 }];

    for (const slotId of [w.kanharSlot.id, 9999]) {
      const error = await expectRejected(
        await post(app, batchBody(w, lines, { locationId: w.msh.id, slotId })),
        400,
        'VALIDATION_ERROR',
      );
      expect(error.message).toBe('Please check the highlighted fields.');
      expect(error.details).toEqual({ fieldErrors: { slotId: ['Choose a delivery slot'] } });
    }
  });

  it('#11 rejects express when the vendor disabled it', async () => {
    await prisma.deliverySettings.update({ where: { id: 1 }, data: { expressEnabled: false } });
    const { app } = makeApp();
    const error = await expectRejected(
      await post(app, expressBody(w, [{ menuItemId: w.A.id, quantity: 1 }])),
      409,
      'EXPRESS_UNAVAILABLE',
    );
    expect(error.details).toEqual({ reason: 'DISABLED' });
    expect(error.message).toBe('Express delivery is currently unavailable.');
  });

  it('#11 rejects express outside its hours (10:00 IST)', async () => {
    const { app } = makeApp({ now: istInstant('10:00') });
    const error = await expectRejected(
      await post(app, expressBody(w, [{ menuItemId: w.A.id, quantity: 1 }])),
      409,
      'EXPRESS_UNAVAILABLE',
    );
    expect(error.details).toEqual({ reason: 'OUTSIDE_HOURS' });
  });

  it('#11 rejects express to an inactive location, and to an unknown one', async () => {
    await prisma.deliveryLocation.update({
      where: { id: w.kanhar.id },
      data: { isActive: false },
    });
    const { app } = makeApp();
    const lines = [{ menuItemId: w.A.id, quantity: 1 }];

    await expectRejected(await post(app, expressBody(w, lines)), 409, 'LOCATION_UNAVAILABLE');
    const error = await expectRejected(
      await post(app, expressBody(w, lines, { locationId: 9999 })),
      400,
      'VALIDATION_ERROR',
    );
    expect(error.details).toEqual({ fieldErrors: { locationId: ['Choose where to deliver'] } });
  });

  it('#12 rejects an express payload that carries a slotId', async () => {
    const { app } = makeApp();
    await expectRejected(
      await post(
        app,
        expressBody(w, [{ menuItemId: w.A.id, quantity: 1 }], { slotId: w.kanharSlot.id }),
      ),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('#13 lists every disabled, deleted or unknown item as ITEM_UNAVAILABLE, before stock', async () => {
    const disabled = await createMenuItem({ name: 'Mutton Biryani', isAvailable: false });
    const deleted = await createMenuItem({ name: 'Egg Biryani', isActive: false });
    const { app } = makeApp();

    const error = await expectRejected(
      await post(
        app,
        batchBody(w, [
          { menuItemId: 9999, quantity: 1 },
          { menuItemId: deleted.id, quantity: 1 },
          { menuItemId: w.B.id, quantity: 6 }, // short as well: ITEM_UNAVAILABLE wins
          { menuItemId: disabled.id, quantity: 1 },
        ]),
      ),
      409,
      'ITEM_UNAVAILABLE',
    );
    expect(error.details).toEqual({
      items: [{ menuItemId: disabled.id }, { menuItemId: deleted.id }, { menuItemId: 9999 }],
    });
    expect(error.message).toBe('Some items are no longer available.');
  });

  it('#14 rejects quantity 11, 11 after merging, and 11 lines', async () => {
    const { app } = makeApp();

    await expectRejected(
      await post(app, batchBody(w, [{ menuItemId: w.A.id, quantity: 11 }])),
      400,
      'VALIDATION_ERROR',
    );

    const merged = await expectRejected(
      await post(
        app,
        batchBody(w, [
          { menuItemId: w.A.id, quantity: 6 },
          { menuItemId: w.A.id, quantity: 5 },
        ]),
      ),
      400,
      'VALIDATION_ERROR',
    );
    expect(merged.message).toBe('Please check the highlighted fields.');
    expect(merged.details).toEqual({ fieldErrors: { items: ['Max 10 of each item per order'] } });

    const elevenLines = Array.from({ length: 11 }, () => ({ menuItemId: w.A.id, quantity: 1 }));
    await expectRejected(await post(app, batchBody(w, elevenLines)), 400, 'VALIDATION_ERROR');
  });

  it('#15 lists every short item as OUT_OF_STOCK with what is available', async () => {
    const { app } = makeApp();
    const error = await expectRejected(
      await post(
        app,
        batchBody(w, [
          { menuItemId: w.B.id, quantity: 6 },
          { menuItemId: w.A.id, quantity: 6 },
        ]),
      ),
      409,
      'OUT_OF_STOCK',
    );
    expect(error.details).toEqual({
      items: [
        { menuItemId: w.A.id, name: 'Chicken Biryani', available: 5 },
        { menuItemId: w.B.id, name: 'Paneer Biryani', available: 5 },
      ],
    });
    expect(error.message).toBe('Some items are out of stock.');
  });

  it('#16 treats an item stocked yesterday as OUT_OF_STOCK with 0 available', async () => {
    const old = await createMenuItem({ name: 'Old Biryani', stockDate: '2026-10-03' });
    const { app } = makeApp();
    const error = await expectRejected(
      await post(app, batchBody(w, [{ menuItemId: old.id, quantity: 1 }], { expectedTotal: 150 })),
      409,
      'OUT_OF_STOCK',
    );
    expect(error.details).toEqual({
      items: [{ menuItemId: old.id, name: 'Old Biryani', available: 0 }],
    });
    const after = await prisma.menuItem.findUniqueOrThrow({ where: { id: old.id } });
    expect(after.stockRemaining).toBe(10);
  });

  it('#17 rejects a stale expectedTotal with PRICE_CHANGED and rolls back the reservation', async () => {
    const { app } = makeApp();
    const error = await expectRejected(
      await post(app, batchBody(w, [{ menuItemId: w.A.id, quantity: 2 }], { expectedTotal: 299 })),
      409,
      'PRICE_CHANGED',
    );
    expect(error.details).toEqual({ total: 300 });
    expect(error.message).toBe('Prices changed. Please check the new total.');
  });

  it('#18 caps open orders per phone at 3; a completed order frees a place', async () => {
    const { app } = makeApp();
    const one = () => batchBody(w, [{ menuItemId: w.A.id, quantity: 1 }]);

    const first = await placed(app, one());
    await placed(app, one());
    await placed(app, one());

    const error = await expectRejected(await post(app, one()), 429, 'TOO_MANY_OPEN_ORDERS', {
      orders: 3,
      stock: { A: 2, B: 5, C: 1 },
    });
    expect(error.details).toEqual({ limit: 3 });
    expect(error.message).toBe('You already have 3 orders waiting for delivery today.');

    await prisma.order.update({
      where: { orderNumber: first.orderNumber },
      data: { status: 'COMPLETED', completedAt: new Date(TEST_NOW) },
    });
    await placed(app, one());
    expect((await stock()).A).toBe(1);
  });

  it("#18 doesn't count cancelled orders or another day's open orders", async () => {
    const base = { locationId: w.msh.id, slotId: w.mshSlot.id };
    for (let i = 0; i < 2; i++) {
      await createOrderRow(base, {
        status: 'CANCELLED',
        cancelledAt: new Date(TEST_NOW),
        customerPhone: '9876543210',
      });
    }
    await createOrderRow(base, {
      customerPhone: '9876543210',
      deliveryDate: toDbDate('2026-10-03'),
    });
    const { app } = makeApp();
    const one = () => batchBody(w, [{ menuItemId: w.A.id, quantity: 1 }]);

    await placed(app, one());
    await placed(app, one());
    await placed(app, one());
    expect((await stock()).A).toBe(2);
  });

  it('#19 rate-limits order attempts per IP with Retry-After', async () => {
    const { app } = makeApp({ limits: { order: { windowMs: 60_000, max: 2 } } });
    const one = () => batchBody(w, [{ menuItemId: w.A.id, quantity: 1 }]);

    await placed(app, one());
    await placed(app, one());
    const res = await post(app, one());

    await expectRejected(res, 429, 'RATE_LIMITED', { orders: 2, stock: { A: 3, B: 5, C: 1 } });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('POST /api/orders — idempotency', () => {
  it('#20 replays the same body: 201 then 200, one row, stock taken once', async () => {
    const { app } = makeApp();
    const body = batchBody(w, [{ menuItemId: w.A.id, quantity: 2 }]);

    const first = await placed(app, body);
    const res = await post(app, body);

    expect(res.status).toBe(200);
    const replay = parsed(res);
    expect(replay.replayed).toBe(true);
    expect({ ...replay, replayed: false }).toEqual(first);
    expect(await prisma.order.count()).toBe(1);
    expect((await stock()).A).toBe(3);
  });

  it('#21 rejects the same clientRequestId from a different phone', async () => {
    const { app } = makeApp();
    const body = batchBody(w, [{ menuItemId: w.A.id, quantity: 2 }]);
    await placed(app, body);

    const error = await expectRejected(
      await post(app, { ...body, customerPhone: '9123456789' }),
      409,
      'IDEMPOTENCY_CONFLICT',
      { orders: 1, stock: { A: 3, B: 5, C: 1 } },
    );
    expect(error.message).toBe('Something went wrong. Please tap Place order again.');
  });
});

describe('POST /api/orders — logs', () => {
  it('L1 logs order.created and order.rejected without the name, phone or address', async () => {
    const { logger, lines } = captureLogger();
    const { app } = makeApp({ logger });

    const ok = await post(app, batchBody(w, [{ menuItemId: w.A.id, quantity: 2 }]));
    expect(ok.status).toBe(201);
    const stale = await post(
      app,
      batchBody(w, [{ menuItemId: w.A.id, quantity: 2 }], { expectedTotal: 299 }),
    );
    expect(stale.status).toBe(409);

    const created = lines.find((l) => l.msg === 'order.created');
    expect(created).toMatchObject({
      level: 'info',
      orderNumber: 'BB1001',
      deliveryMode: 'BATCH',
      total: 300,
      reqId: ok.headers['x-request-id'],
    });
    const rejected = lines.find((l) => l.msg === 'order.rejected');
    expect(rejected).toMatchObject({ code: 'PRICE_CHANGED', reqId: stale.headers['x-request-id'] });

    const text = JSON.stringify(lines);
    for (const secret of ['9876543210', 'Rahul', 'Room 214']) expect(text).not.toContain(secret);
  });
});
