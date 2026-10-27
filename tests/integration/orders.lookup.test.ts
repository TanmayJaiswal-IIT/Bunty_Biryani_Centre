import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { publicOrderViewSchema } from '../../src/shared/schemas/order.js';
import { makeApp } from '../helpers/app.js';
import { TEST_NOW, TEST_TODAY } from '../helpers/clock.js';
import { prisma } from '../helpers/db.js';
import { assertInventoryInvariant } from '../helpers/invariant.js';
import { setupOrderTestDb, type SetupOrderResult } from '../helpers/order-fixtures.js';

describe('POST /api/orders/lookup integration (Batch 5 §12.2)', () => {
  let fixtures: SetupOrderResult;
  let orderNumber: string;

  beforeEach(async () => {
    fixtures = await setupOrderTestDb(prisma, TEST_TODAY);
    const { app } = makeApp({ now: TEST_NOW, prisma });

    // Place one initial order
    const res = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: '10000000-0000-4000-8000-000000000001',
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
    orderNumber = res.body.orderNumber as string;
    expect(orderNumber).toBe('BB1001');
  });

  it('26: Correct phone in another format (+91 98765-43210) -> 200 public view', async () => {
    const { app } = makeApp({ now: TEST_NOW, prisma });

    const res = await request(app)
      .post('/api/orders/lookup')
      .send({
        orderNumber: 'BB1001',
        phone: '+91 98765-43210',
      });

    expect(res.status).toBe(200);
    expect(res.body.orderNumber).toBe('BB1001');
    expect(res.body.customerName).toBe('Rahul Verma');
    expect(res.body.total).toBe(300);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe('Chicken Biryani');
    expect(res.body.items[0].quantity).toBe(2);

    // Validate with zod schema
    expect(() => publicOrderViewSchema.parse(res.body)).not.toThrow();
  });

  it('27: Wrong phone and unknown order return 404 with byte-identical body', async () => {
    const { app } = makeApp({ now: TEST_NOW, prisma });

    // Wrong phone for existing order
    const resWrongPhone = await request(app)
      .post('/api/orders/lookup')
      .send({
        orderNumber: 'BB1001',
        phone: '9876543211',
      });

    expect(resWrongPhone.status).toBe(404);
    expect(resWrongPhone.body.error.code).toBe('ORDER_NOT_FOUND');
    expect(resWrongPhone.body.error.message).toBe(
      "We couldn't find an order with that ID and mobile number.",
    );

    // Unknown order
    const resUnknownOrder = await request(app)
      .post('/api/orders/lookup')
      .send({
        orderNumber: 'BB9999',
        phone: '9876543210',
      });

    expect(resUnknownOrder.status).toBe(404);
    expect(resUnknownOrder.text).toBe(resWrongPhone.text);
  });

  it('28: bb1001 and 1001 both find BB1001', async () => {
    const { app } = makeApp({ now: TEST_NOW, prisma });

    const res1 = await request(app)
      .post('/api/orders/lookup')
      .send({
        orderNumber: 'bb1001',
        phone: '9876543210',
      });
    expect(res1.status).toBe(200);
    expect(res1.body.orderNumber).toBe('BB1001');

    const res2 = await request(app)
      .post('/api/orders/lookup')
      .send({
        orderNumber: '1001',
        phone: '9876543210',
      });
    expect(res2.status).toBe(200);
    expect(res2.body.orderNumber).toBe('BB1001');

    const res3 = await request(app)
      .post('/api/orders/lookup')
      .send({
        orderNumber: '  BB1001  ',
        phone: '9876543210',
      });
    expect(res3.status).toBe(200);
    expect(res3.body.orderNumber).toBe('BB1001');
  });

  it('29: Rate limit lowered to 2 -> 2 failed lookups, then 3rd gets 429; 10 successful lookups never get 429', async () => {
    // App with lookup limit of 2 failed attempts per window
    const { app } = makeApp({
      now: TEST_NOW,
      prisma,
      limits: {
        lookup: { windowMs: 600000, max: 2 },
      },
    });

    // 1st failed lookup
    const fail1 = await request(app)
      .post('/api/orders/lookup')
      .send({ orderNumber: 'BB9999', phone: '9876543210' });
    expect(fail1.status).toBe(404);

    // 2nd failed lookup
    const fail2 = await request(app)
      .post('/api/orders/lookup')
      .send({ orderNumber: 'BB9999', phone: '9876543210' });
    expect(fail2.status).toBe(404);

    // 3rd failed lookup should be rate limited 429
    const fail3 = await request(app)
      .post('/api/orders/lookup')
      .send({ orderNumber: 'BB9999', phone: '9876543210' });
    expect(fail3.status).toBe(429);
    expect(fail3.body.error.code).toBe('RATE_LIMITED');
    expect(fail3.headers['retry-after']).toBeDefined();

    // Fresh limiter: 10 successful lookups never get 429
    const { app: freshApp } = makeApp({
      now: TEST_NOW,
      prisma,
      limits: {
        lookup: { windowMs: 600000, max: 2 },
      },
    });

    for (let i = 0; i < 10; i++) {
      const ok = await request(freshApp)
        .post('/api/orders/lookup')
        .send({ orderNumber: 'BB1001', phone: '9876543210' });
      expect(ok.status).toBe(200);
    }
  });

  it('30: Response contains no internal id and no phone number', async () => {
    const { app } = makeApp({ now: TEST_NOW, prisma });

    const res = await request(app)
      .post('/api/orders/lookup')
      .send({
        orderNumber: 'BB1001',
        phone: '9876543210',
      });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;

    // Top-level must not leak internal id or customer phone
    expect(body.id).toBeUndefined();
    expect(body.customerPhone).toBeUndefined();
    expect(body.phone).toBeUndefined();

    // Items must not leak internal id
    const items = body.items as Record<string, unknown>[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.id).toBeUndefined();
      expect(item.orderId).toBeUndefined();
      expect(item.menuItemId).toBeUndefined();
    }

    await assertInventoryInvariant(prisma);
  });
});
