import type { Express } from 'express';
import request, { type Response } from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publicOrderViewSchema } from '../../src/shared/schemas/order';
import { makeApp } from '../helpers/app';
import { expectInventoryInvariant } from '../helpers/invariant';
import { batchBody, seedOrderWorld, type OrderWorld } from '../helpers/order-fixtures';

let w: OrderWorld;

beforeEach(async () => {
  w = await seedOrderWorld();
});

afterEach(expectInventoryInvariant);

const PHONE = '9876543210';

function lookup(app: Express, body: Record<string, unknown>) {
  return request(app).post('/api/orders/lookup').send(body);
}

/** Places BB1001 (2 × A, batch MSH, phone 9876543210) through the API. */
async function placeFirstOrder(app: Express): Promise<Response> {
  const res = await request(app)
    .post('/api/orders')
    .send(batchBody(w, [{ menuItemId: w.A.id, quantity: 2 }]));
  expect(res.status, res.text).toBe(201);
  expect(res.body.orderNumber).toBe('BB1001');
  return res;
}

describe('POST /api/orders/lookup', () => {
  it('#26 finds the order when the phone is typed in another format', async () => {
    const { app } = makeApp();
    await placeFirstOrder(app);

    const res = await lookup(app, { orderNumber: 'BB1001', phone: '+91 98765-43210' });

    expect(res.status, res.text).toBe(200);
    expect(publicOrderViewSchema.parse(res.body)).toMatchObject({
      orderNumber: 'BB1001',
      status: 'ORDER_RECEIVED',
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      deliveryMode: 'BATCH',
      locationName: 'MSH',
      slotDeliveryTime: '20:00',
      customerName: 'Rahul Verma',
      items: [{ name: 'Chicken Biryani', unitPrice: 150, quantity: 2, lineTotal: 300 }],
      total: 300,
    });
  });

  it('#27 answers a wrong phone and an unknown order with the same 404, byte for byte', async () => {
    const { app } = makeApp();
    await placeFirstOrder(app);

    const wrongPhone = await lookup(app, { orderNumber: 'BB1001', phone: '9123456789' });
    const unknown = await lookup(app, { orderNumber: 'BB1999', phone: '9123456789' });

    expect(wrongPhone.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(wrongPhone.body.error.code).toBe('ORDER_NOT_FOUND');
    expect(wrongPhone.body.error.message).toBe(
      "We couldn't find an order with that ID and mobile number.",
    );
    expect(wrongPhone.text).toBe(unknown.text);
  });

  it('#28 finds BB1001 from "bb1001", " BB1001 " and "1001"', async () => {
    const { app } = makeApp();
    await placeFirstOrder(app);

    for (const orderNumber of ['bb1001', ' BB1001 ', '1001']) {
      const res = await lookup(app, { orderNumber, phone: PHONE });
      expect(res.status, `${orderNumber}: ${res.text}`).toBe(200);
      expect(res.body.orderNumber).toBe('BB1001');
    }
  });

  it('#29 counts failed lookups only: two failures lock the IP out', async () => {
    const limits = { lookup: { windowMs: 60_000, max: 2 } };
    const { app } = makeApp({ limits });
    await placeFirstOrder(app);

    expect((await lookup(app, { orderNumber: 'BB1001', phone: '9123456789' })).status).toBe(404);
    expect((await lookup(app, { orderNumber: 'BB1002', phone: PHONE })).status).toBe(404);

    // Even a correct lookup is refused once the failed ones used the allowance up.
    const third = await lookup(app, { orderNumber: 'BB1001', phone: PHONE });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('#29 never rate-limits successful lookups (the confirmation page refreshes through them)', async () => {
    const { app } = makeApp({ limits: { lookup: { windowMs: 60_000, max: 2 } } });
    await placeFirstOrder(app);

    for (let i = 0; i < 10; i++) {
      const res = await lookup(app, { orderNumber: 'BB1001', phone: PHONE });
      expect(res.status, `lookup ${i + 1}: ${res.text}`).toBe(200);
    }
  });

  it('#30 returns exactly the public view: no id, no phone, no replayed', async () => {
    const { app } = makeApp();
    await placeFirstOrder(app);

    const res = await lookup(app, { orderNumber: 'BB1001', phone: PHONE });

    expect(res.status, res.text).toBe(200);
    expect(() => publicOrderViewSchema.parse(res.body)).not.toThrow();
    expect(res.body).not.toHaveProperty('replayed');
    expect(res.body).not.toHaveProperty('id');
    expect(res.text).not.toContain(PHONE);
  });

  it('rejects a malformed lookup with VALIDATION_ERROR and an unknown key', async () => {
    const { app } = makeApp();

    const badId = await lookup(app, { orderNumber: 'hello', phone: PHONE });
    expect(badId.status).toBe(400);
    expect(badId.body.error.code).toBe('VALIDATION_ERROR');

    const extra = await lookup(app, { orderNumber: 'BB1001', phone: PHONE, admin: true });
    expect(extra.status).toBe(400);
  });
});
