import type { Express } from 'express';
import request, { type Response } from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toDbDate } from '../../src/server/lib/db-date';
import { setTodayStock } from '../../src/server/services/inventory.service';
import type { AdminOrderView, CompleteManyResult } from '../../src/shared/api-types';
import {
  adminOrderViewSchema,
  completeManyResultSchema,
} from '../../src/shared/schemas/admin-views';
import { publicMenuSchema } from '../../src/shared/schemas/menu';
import { createOrderResponseSchema } from '../../src/shared/schemas/order';
import { captureLogger, makeApp } from '../helpers/app';
import { istInstant, TEST_NOW, TEST_TODAY, type TestClock } from '../helpers/clock';
import { prisma } from '../helpers/db';
import { createAdmin, createMenuItem } from '../helpers/factories';
import { adminClient, type AdminClient } from '../helpers/http';
import { expectInventoryInvariant } from '../helpers/invariant';
import {
  batchBody,
  expressBody,
  phoneN,
  seedOrderWorld,
  type OrderWorld,
} from '../helpers/order-fixtures';

// Order actions through the status machine (Batch 6 §9.4, #16-#21), the order detail and the
// route guards (AO1), and a cancel racing a new order for the same item (OC1, Review Focus 2).

let w: OrderWorld;
let admin: AdminClient;

beforeEach(async () => {
  await createAdmin();
  w = await seedOrderWorld();
});

afterEach(expectInventoryInvariant);

const one = (item: { id: number }, quantity = 1) => [{ menuItemId: item.id, quantity }];

/** Places an order through the public API; the admin id comes from the database (the public view has none). */
async function place(app: Express, body: Record<string, unknown>) {
  const res = await request(app).post('/api/orders').send(body);
  expect(res.status, res.text).toBe(201);
  const { orderNumber } = createOrderResponseSchema.parse(res.body);
  const row = await prisma.order.findUniqueOrThrow({ where: { orderNumber } });
  return { id: row.id, orderNumber };
}

function view(res: Response): AdminOrderView {
  expect(res.status, res.text).toBe(200);
  return adminOrderViewSchema.parse(res.body);
}

function counts(res: Response): CompleteManyResult {
  expect(res.status, res.text).toBe(200);
  return completeManyResultSchema.parse(res.body);
}

const patch = (id: number, body: unknown) =>
  admin.send('patch', `/api/admin/orders/${id}/status`, body);
const completeMany = (orderIds: number[], markCollected: boolean) =>
  admin.send('post', '/api/admin/orders/complete-many', { orderIds, markCollected });

async function remaining(item: { id: number }): Promise<number> {
  const row = await prisma.menuItem.findUniqueOrThrow({ where: { id: item.id } });
  return row.stockRemaining;
}

async function stateOf(id: number) {
  const row = await prisma.order.findUniqueOrThrow({ where: { id } });
  return { status: row.status, paymentStatus: row.paymentStatus };
}

/** A rejection: the status, the code and the message the admin UI will show. */
function expectError(res: Response, status: number, code: string, message?: string) {
  expect(res.status, res.text).toBe(status);
  expect(res.body.error.code).toBe(code);
  if (message) expect(res.body.error.message).toBe(message);
  return res.body.error as { code: string; message: string; details?: Record<string, unknown> };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const iso = (hhmm: string, date?: string) => new Date(istInstant(hhmm, date)).toISOString();

describe('PATCH /api/admin/orders/:id/status', () => {
  let app: Express;
  let clock: TestClock;

  beforeEach(async () => {
    ({ app, clock } = makeApp());
    admin = await adminClient(app);
  });

  it('#16 complete / reopen / collect / undo set and clear the timestamps; repeats are no-ops', async () => {
    const { id } = await place(app, batchBody(w, one(w.A)));

    clock.set(istInstant('19:15'));
    const done = view(await patch(id, { status: 'COMPLETED' }));
    expect(done).toMatchObject({
      id,
      status: 'COMPLETED',
      paymentStatus: 'PENDING',
      completedAt: iso('19:15'),
      collectedAt: null,
      cancelledAt: null,
    });

    // Same request later: 200, the same state, and the first timestamp is kept.
    clock.set(istInstant('19:16'));
    expect(view(await patch(id, { status: 'COMPLETED' }))).toEqual(done);

    const reopened = view(await patch(id, { status: 'ORDER_RECEIVED' }));
    expect(reopened).toMatchObject({ status: 'ORDER_RECEIVED', completedAt: null });
    expect(view(await patch(id, { status: 'ORDER_RECEIVED' }))).toEqual(reopened);

    clock.set(istInstant('19:25'));
    const collected = view(await patch(id, { paymentStatus: 'COLLECTED' }));
    expect(collected).toMatchObject({
      status: 'ORDER_RECEIVED',
      paymentStatus: 'COLLECTED',
      collectedAt: iso('19:25'),
    });
    clock.set(istInstant('19:26'));
    expect(view(await patch(id, { paymentStatus: 'COLLECTED' }))).toEqual(collected);

    const undone = view(await patch(id, { paymentStatus: 'PENDING' }));
    expect(undone).toMatchObject({ paymentStatus: 'PENDING', collectedAt: null });
    expect(view(await patch(id, { paymentStatus: 'PENDING' }))).toEqual(undone);
  });

  it('#17 cancel marks the order, restores the stock and raises the public maxQty again', async () => {
    const { id } = await place(app, batchBody(w, one(w.A, 2)));
    expect(await remaining(w.A)).toBe(3);

    clock.set(istInstant('19:20'));
    const cancelled = view(await patch(id, { status: 'CANCELLED' }));
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'PENDING',
      cancelledAt: iso('19:20'),
      completedAt: null,
      collectedAt: null,
    });
    expect(await remaining(w.A)).toBe(5);

    const menu = publicMenuSchema.parse((await request(app).get('/api/menu')).body);
    expect(menu.items.find((item) => item.id === w.A.id)).toMatchObject({
      soldOut: false,
      maxQty: 5,
      onlyLeft: 5,
    });
  });

  it('#18 cancel is refused while cash is collected or the order is completed; a cancelled order accepts nothing', async () => {
    const collected = await place(app, batchBody(w, one(w.A), { customerPhone: phoneN(1) }));
    view(await patch(collected.id, { paymentStatus: 'COLLECTED' }));
    let error = expectError(
      await patch(collected.id, { status: 'CANCELLED' }),
      409,
      'INVALID_TRANSITION',
      'Undo cash collected before cancelling.',
    );
    expect(error.details).toEqual({ from: 'COLLECTED', to: 'CANCELLED' });
    expect(await stateOf(collected.id)).toEqual({
      status: 'ORDER_RECEIVED',
      paymentStatus: 'COLLECTED',
    });

    const completed = await place(app, batchBody(w, one(w.A), { customerPhone: phoneN(2) }));
    view(await patch(completed.id, { status: 'COMPLETED' }));
    error = expectError(
      await patch(completed.id, { status: 'CANCELLED' }),
      409,
      'INVALID_TRANSITION',
      'Reopen the order before cancelling.',
    );
    expect(error.details).toEqual({ from: 'COMPLETED', to: 'CANCELLED' });

    // Completed and collected: the cash has to be undone first, then the order reopened.
    view(await patch(completed.id, { paymentStatus: 'COLLECTED' }));
    error = expectError(
      await patch(completed.id, { status: 'CANCELLED' }),
      409,
      'INVALID_TRANSITION',
      'Undo cash collected before cancelling.',
    );
    expect(error.details).toEqual({ from: 'COLLECTED', to: 'CANCELLED' });
    expect(await remaining(w.A)).toBe(3);

    const cancelled = await place(app, batchBody(w, one(w.A), { customerPhone: phoneN(3) }));
    view(await patch(cancelled.id, { status: 'CANCELLED' }));
    const frozen = await prisma.order.findUniqueOrThrow({ where: { id: cancelled.id } });
    const attempts: Array<[unknown, { from: string; to: string }]> = [
      [{ status: 'COMPLETED' }, { from: 'CANCELLED', to: 'COMPLETED' }],
      [{ status: 'ORDER_RECEIVED' }, { from: 'CANCELLED', to: 'ORDER_RECEIVED' }],
      [{ paymentStatus: 'COLLECTED' }, { from: 'PENDING', to: 'COLLECTED' }],
    ];
    for (const [body, details] of attempts) {
      error = expectError(
        await patch(cancelled.id, body),
        409,
        'INVALID_TRANSITION',
        'This order was cancelled.',
      );
      expect(error.details).toEqual(details);
    }
    expect(await prisma.order.findUniqueOrThrow({ where: { id: cancelled.id } })).toEqual(frozen);
  });

  it('#19 cancelling twice restores the stock once, in sequence and at the same time', async () => {
    const first = await place(app, batchBody(w, one(w.A, 2), { customerPhone: phoneN(1) }));
    clock.set(istInstant('19:20'));
    const cancelled = view(await patch(first.id, { status: 'CANCELLED' }));
    expect(await remaining(w.A)).toBe(5);

    clock.set(istInstant('19:21'));
    expect(view(await patch(first.id, { status: 'CANCELLED' }))).toEqual(cancelled);
    expect(await remaining(w.A)).toBe(5);

    const second = await place(app, batchBody(w, one(w.A, 2), { customerPhone: phoneN(2) }));
    expect(await remaining(w.A)).toBe(3);
    const results = await Promise.all([
      patch(second.id, { status: 'CANCELLED' }),
      patch(second.id, { status: 'CANCELLED' }),
    ]);
    const [a, b] = results.map(view);
    expect(a).toEqual(b);
    expect(a?.status).toBe('CANCELLED');
    expect(await remaining(w.A)).toBe(5);
  });

  it("#20 cancelling yesterday's order leaves today's stock alone", async () => {
    await prisma.menuItem.update({
      where: { id: w.A.id },
      data: { stockDate: toDbDate('2026-10-03') },
    });
    clock.set(istInstant('19:10', '2026-10-03'));
    const { id } = await place(app, batchBody(w, one(w.A, 2)));
    expect(await remaining(w.A)).toBe(3);

    clock.set(TEST_NOW);
    await prisma.$transaction((tx) =>
      setTodayStock(tx, TEST_TODAY, [{ menuItemId: w.A.id, stock: 20 }]),
    );
    expect(await remaining(w.A)).toBe(20);

    const cancelled = view(await patch(id, { status: 'CANCELLED' }));
    expect(cancelled).toMatchObject({ status: 'CANCELLED', deliveryDate: '2026-10-03' });
    expect(await remaining(w.A)).toBe(20);
  });
});

describe('POST /api/admin/orders/complete-many', () => {
  let app: Express;

  beforeEach(async () => {
    ({ app } = makeApp());
    admin = await adminClient(app);
  });

  async function openMshOrders(n: number): Promise<number[]> {
    const ids: number[] = [];
    for (let i = 1; i <= n; i++) {
      const { id } = await place(app, batchBody(w, one(w.B), { customerPhone: phoneN(i) }));
      ids.push(id);
    }
    return ids;
  }

  it('#21 completes and collects the listed ids only, and is all or nothing', async () => {
    const [o1, o2, o3, o4] = (await openMshOrders(4)) as [number, number, number, number];

    expect(counts(await completeMany([o3, o1, o2], true))).toEqual({ completed: 3, collected: 3 });
    for (const id of [o1, o2, o3]) {
      expect(await stateOf(id)).toEqual({ status: 'COMPLETED', paymentStatus: 'COLLECTED' });
    }
    expect(await stateOf(o4)).toEqual({ status: 'ORDER_RECEIVED', paymentStatus: 'PENDING' });

    // Already completed and collected: counted as 0.
    expect(counts(await completeMany([o1, o2, o3], true))).toEqual({ completed: 0, collected: 0 });

    // An unknown id: 404, and o4 (which sorts before it) is not completed.
    expectError(await completeMany([o4, 999_999], true), 404, 'NOT_FOUND', 'Order not found.');
    expect(await stateOf(o4)).toEqual({ status: 'ORDER_RECEIVED', paymentStatus: 'PENDING' });

    // A cancelled id: 409, and o4 (which sorts before it) is not completed.
    const { id: o5 } = await place(app, batchBody(w, one(w.B), { customerPhone: phoneN(5) }));
    view(await patch(o5, { status: 'CANCELLED' }));
    const error = expectError(
      await completeMany([o4, o5], true),
      409,
      'INVALID_TRANSITION',
      'This order was cancelled.',
    );
    expect(error.details).toEqual({ from: 'CANCELLED', to: 'COMPLETED' });
    expect(await stateOf(o4)).toEqual({ status: 'ORDER_RECEIVED', paymentStatus: 'PENDING' });
    expect(await stateOf(o5)).toEqual({ status: 'CANCELLED', paymentStatus: 'PENDING' });

    // Completed without cash, then cash alone: the two counts are independent.
    expect(counts(await completeMany([o4], false))).toEqual({ completed: 1, collected: 0 });
    expect(await stateOf(o4)).toEqual({ status: 'COMPLETED', paymentStatus: 'PENDING' });
    expect(counts(await completeMany([o4], true))).toEqual({ completed: 0, collected: 1 });
    expect(await stateOf(o4)).toEqual({ status: 'COMPLETED', paymentStatus: 'COLLECTED' });
  });

  it('uses the request clock for completedAt and collectedAt, once for every order', async () => {
    const ids = await openMshOrders(2);
    const { app: timed, clock } = makeApp();
    admin = await adminClient(timed);
    clock.set(istInstant('19:40'));

    counts(await completeMany(ids, true));

    const rows = await prisma.order.findMany({ where: { id: { in: ids } } });
    for (const row of rows) {
      expect(row.completedAt?.toISOString()).toBe(iso('19:40'));
      expect(row.collectedAt?.toISOString()).toBe(iso('19:40'));
    }
  });
});

describe('admin order view and route guards (AO1)', () => {
  let app: Express;
  let clock: TestClock;

  beforeEach(async () => {
    ({ app, clock } = makeApp());
    admin = await adminClient(app);
  });

  it('answers 404 NOT_FOUND for an id that is not a usable number or has no order', async () => {
    const missing = [
      '/api/admin/orders/abc',
      '/api/admin/orders/2147483648',
      '/api/admin/orders/0',
      '/api/admin/orders/999999',
    ];
    for (const path of missing) expectError(await admin.get(path), 404, 'NOT_FOUND');
    expectError(await admin.get('/api/admin/orders/999999'), 404, 'NOT_FOUND', 'Order not found.');

    for (const id of ['abc', '2147483648', '999999']) {
      expectError(
        await admin.send('patch', `/api/admin/orders/${id}/status`, { status: 'COMPLETED' }),
        404,
        'NOT_FOUND',
      );
    }
    expectError(
      await patch(999_999, { paymentStatus: 'COLLECTED' }),
      404,
      'NOT_FOUND',
      'Order not found.',
    );
  });

  it('rejects a PATCH that is not exactly one valid action, and a bad complete-many body', async () => {
    const { id } = await place(app, batchBody(w, one(w.A)));
    const bad: unknown[] = [
      { status: 'COMPLETED', paymentStatus: 'COLLECTED' },
      {},
      { status: 'PAID' },
      { paymentStatus: 'PAID' },
      { status: 'COMPLETED', note: 'x' },
    ];
    for (const body of bad) expectError(await patch(id, body), 400, 'VALIDATION_ERROR');

    const badMany: unknown[] = [
      { orderIds: [], markCollected: true },
      { orderIds: [id, id], markCollected: true },
      { orderIds: [id] },
      { orderIds: [id], markCollected: true, extra: 1 },
    ];
    for (const body of badMany) {
      expectError(
        await admin.send('post', '/api/admin/orders/complete-many', body),
        400,
        'VALIDATION_ERROR',
      );
    }
    expect(await stateOf(id)).toEqual({ status: 'ORDER_RECEIVED', paymentStatus: 'PENDING' });
  });

  it('shows a batch order with its snapshots, items in cart order and the customer phone', async () => {
    const { id, orderNumber } = await place(
      app,
      batchBody(w, [
        { menuItemId: w.B.id, quantity: 1 },
        { menuItemId: w.A.id, quantity: 2 },
      ]),
    );

    expect(view(await admin.get(`/api/admin/orders/${id}`))).toEqual({
      id,
      orderNumber,
      status: 'ORDER_RECEIVED',
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      deliveryMode: 'BATCH',
      deliveryDate: TEST_TODAY,
      locationId: w.msh.id,
      locationName: 'MSH',
      slotId: w.mshSlot.id,
      slotDeliveryTime: '20:00',
      expressWindow: null,
      isLate: false,
      customerName: 'Rahul Verma',
      customerPhone: '9876543210',
      addressDetail: 'Room 214, B block',
      items: [
        { menuItemId: w.B.id, name: 'Paneer Biryani', unitPrice: 130, quantity: 1, lineTotal: 130 },
        {
          menuItemId: w.A.id,
          name: 'Chicken Biryani',
          unitPrice: 150,
          quantity: 2,
          lineTotal: 300,
        },
      ],
      itemCount: 3,
      foodSubtotal: 430,
      deliveryFee: 0,
      total: 430,
      createdAt: TEST_NOW,
      completedAt: null,
      cancelledAt: null,
      collectedAt: null,
    });
  });

  it('shows an express order with its window and flags it late only while it is open', async () => {
    const { id } = await place(app, expressBody(w, one(w.A)));

    const onTime = view(await admin.get(`/api/admin/orders/${id}`));
    expect(onTime).toMatchObject({
      deliveryMode: 'EXPRESS',
      slotId: null,
      slotDeliveryTime: null,
      deliveryFee: 30,
      total: 180,
      isLate: false,
      expressWindow: { from: '19:40', to: '19:50', etaText: '30–40 minutes' },
    });

    clock.set(istInstant('19:50'));
    expect(view(await admin.get(`/api/admin/orders/${id}`)).isLate).toBe(false);
    clock.set(istInstant('19:51'));
    expect(view(await admin.get(`/api/admin/orders/${id}`)).isLate).toBe(true);
    // The PATCH response is computed on the same clock.
    expect(view(await patch(id, { paymentStatus: 'COLLECTED' })).isLate).toBe(true);
    expect(view(await patch(id, { status: 'COMPLETED' })).isLate).toBe(false);
  });
});

describe('a cancel racing a new order for the same item (OC1)', () => {
  it('never deadlocks or fails, and the stock matches the orders that remain', async () => {
    const { logger, lines } = captureLogger();
    const { app } = makeApp({ logger });
    admin = await adminClient(app);

    // Round 0 is the spec's Raita (C); later rounds use a fresh single-stock item. The new order
    // starts a little later each round, so the sweep lands before, during and after the cancel.
    for (let round = 0; round < 12; round++) {
      const item =
        round === 0
          ? w.C
          : await createMenuItem({
              name: `Raita ${round}`,
              price: 20,
              stock: 1,
              sortOrder: 10 + round,
            });
      const first = await place(
        app,
        batchBody(w, one(item), { customerPhone: phoneN(1), expectedTotal: 20 }),
      );
      expect(await remaining(item)).toBe(0);

      const rival = batchBody(w, one(item), {
        customerPhone: phoneN(10 + round),
        expectedTotal: 20,
      });
      const [cancelled, fresh] = await Promise.all([
        patch(first.id, { status: 'CANCELLED' }),
        sleep(round * 3).then(() => request(app).post('/api/orders').send(rival)),
      ]);

      expect(cancelled.status, cancelled.text).toBe(200);
      expect([201, 409], fresh.text).toContain(fresh.status);
      if (fresh.status === 409) expect(fresh.body.error.code).toBe('OUT_OF_STOCK');

      const alive = await prisma.orderItem.count({
        where: { menuItemId: item.id, order: { status: { not: 'CANCELLED' } } },
      });
      expect(alive).toBe(fresh.status === 201 ? 1 : 0);
      expect(await remaining(item)).toBe(1 - alive);
    }

    expect(lines.filter((line) => line.msg === 'order.retry')).toEqual([]);
    expect(lines.filter((line) => line.level === 'error')).toEqual([]);
  });
});
