import type { Express } from 'express';
import request, { type Response } from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { Prisma } from '../../src/server/db';
import type { MenuItem } from '../../src/server/generated/prisma/client';
import { toDbDate } from '../../src/server/lib/db-date';
import type { CreateOrderResponse } from '../../src/shared/api-types';
import { createOrderResponseSchema } from '../../src/shared/schemas/order';
import { captureLogger, makeApp } from '../helpers/app';
import { istInstant, TEST_NOW, TEST_TODAY } from '../helpers/clock';
import { prisma } from '../helpers/db';
import { expectInventoryInvariant } from '../helpers/invariant';
import { batchBody, phoneN, seedOrderWorld, type OrderWorld } from '../helpers/order-fixtures';

// Overlapping requests (Batch 5 §4 steps 4–6, §11, §12.1 #22–#25). These must stay green for the
// rest of the project (Batch 1 §13).

afterEach(expectInventoryInvariant);

function post(app: Express, body: Record<string, unknown>) {
  return request(app).post('/api/orders').send(body);
}

/** Strict response schema; `replayed` must agree with the status (201 new, 200 replay). */
function parsed(res: Response): CreateOrderResponse {
  const order = createOrderResponseSchema.parse(res.body);
  expect(order.replayed).toBe(res.status === 200);
  return order;
}

function statuses(results: Response[]): number[] {
  return results.map((r) => r.status).sort((a, b) => a - b);
}

function texts(results: Response[]): string {
  return results.map((r) => `${r.status} ${r.text}`).join('\n');
}

async function remaining(item: { id: number }): Promise<number> {
  const row = await prisma.menuItem.findUniqueOrThrow({ where: { id: item.id } });
  return row.stockRemaining;
}

function one(item: { id: number }) {
  return [{ menuItemId: item.id, quantity: 1 }];
}

type Tx = Prisma.TransactionClient;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls until a backend of this database waits on a lock: the request is blocked on our row. */
async function untilWaitingOnLock(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n
        FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (row && row.n > 0) return;
    await sleep(10);
  }
  throw new Error('the request never waited on a lock');
}

/** The one request a held-open transaction sends, kept outside it so a failure can wait for it. */
interface Sent {
  pending?: Promise<Response>;
}

/**
 * Runs `hold` in a transaction held open for up to 15 s. `hold` sends one request while it holds
 * its locks and stores it in `sent.pending`; after the commit, its response is awaited. If the
 * transaction throws, a request already sent is awaited before the error is rethrown, so no
 * request outlives a failed test and bleeds into the next test's reset.
 */
async function holdOpen<T>(
  hold: (tx: Tx, sent: Sent) => Promise<T>,
): Promise<{ held: T; res: Response }> {
  const sent: Sent = {};
  try {
    const held = await prisma.$transaction((tx: Tx) => hold(tx, sent), { timeout: 15_000 });
    if (!sent.pending) throw new Error('the held-open transaction sent no request');
    return { held, res: await sent.pending };
  } catch (err) {
    await sent.pending?.catch(() => {});
    throw err;
  }
}

/**
 * The original request's effects (1 × item, its stock decrement and its order row), written in a
 * transaction that stays open until `retry` is blocked on the item's row lock, then committed.
 * That is §11's overlapping retry, made deterministic.
 */
async function overlapWithOriginal(
  w: OrderWorld,
  item: MenuItem,
  body: Record<string, unknown>,
  retry: () => Promise<Response>,
): Promise<{ orderNumber: string; res: Response }> {
  const { held: order, res } = await holdOpen(async (tx, sent) => {
    await tx.$executeRaw`
      UPDATE menu_items
         SET stock_remaining = stock_remaining - 1, updated_at = now()
       WHERE id = ${item.id}`;
    const order = await tx.order.create({
      data: {
        clientRequestId: body.clientRequestId as string,
        customerName: body.customerName as string,
        customerPhone: body.customerPhone as string,
        addressDetail: body.addressDetail as string,
        deliveryMode: 'BATCH',
        deliveryDate: toDbDate(TEST_TODAY),
        locationId: w.msh.id,
        locationName: 'MSH',
        slotId: w.mshSlot.id,
        slotDeliveryTime: '20:00',
        foodSubtotal: item.price,
        deliveryFee: 0,
        total: item.price,
        createdAt: new Date(TEST_NOW),
        items: {
          create: [
            {
              menuItemId: item.id,
              itemName: item.name,
              unitPrice: item.price,
              quantity: 1,
              lineTotal: item.price,
            },
          ],
        },
      },
    });
    sent.pending = retry();
    await untilWaitingOnLock();
    return order;
  });
  return { orderNumber: order.orderNumber, res };
}

describe('POST /api/orders — the same clientRequestId at once (#22)', () => {
  it('#22 five identical requests: one order, one 201 and four 200 replayed, one number', async () => {
    const w = await seedOrderWorld();
    const { app } = makeApp();
    const body = batchBody(w, [{ menuItemId: w.A.id, quantity: 2 }]);
    const bodies = Array.from({ length: 5 }, () => body);

    const results = await Promise.all(bodies.map((b) => post(app, b)));

    expect(statuses(results), texts(results)).toEqual([200, 200, 200, 200, 201]);
    const orders = results.map(parsed);
    expect(new Set(orders.map((o) => o.orderNumber)).size).toBe(1);
    expect(await prisma.order.count()).toBe(1);
    expect(await remaining(w.A)).toBe(3);
  });

  it('#22 last item: the same request twice → one 201 and one 200, never OUT_OF_STOCK', async () => {
    const w = await seedOrderWorld();
    const { logger, lines } = captureLogger();
    const { app } = makeApp({ logger });
    const body = batchBody(w, one(w.C));

    const results = await Promise.all([body, body].map((b) => post(app, b)));

    expect(statuses(results), texts(results)).toEqual([200, 201]);
    const [a, b] = results.map(parsed);
    expect(a!.orderNumber).toBe(b!.orderNumber);
    expect(await prisma.order.count()).toBe(1);
    expect(await remaining(w.C)).toBe(0);
    // A rejection that turned into a replay was never returned, so it isn't logged.
    expect(lines.filter((l) => l.msg === 'order.rejected')).toEqual([]);
  });

  it('#22 cap: a phone with two open orders sends its third twice → 201 and 200, never 429', async () => {
    const w = await seedOrderWorld();
    const { app } = makeApp();
    const customerPhone = phoneN(1);
    for (let i = 0; i < 2; i++) {
      const res = await post(app, batchBody(w, one(w.A), { customerPhone }));
      expect(res.status, res.text).toBe(201);
    }
    const third = batchBody(w, one(w.A), { customerPhone });

    const results = await Promise.all([third, third].map((b) => post(app, b)));

    expect(statuses(results), texts(results)).toEqual([200, 201]);
    const [a, b] = results.map(parsed);
    expect(a!.orderNumber).toBe(b!.orderNumber);
    expect(await prisma.order.count({ where: { customerPhone } })).toBe(3);
    expect(await remaining(w.A)).toBe(2);
  });

  it('#22 last item, overlap held open: a retry blocked on the original stock lock is replayed (§4 step 5)', async () => {
    const w = await seedOrderWorld();
    const { app } = makeApp();
    const body = batchBody(w, one(w.C));

    // The retry passes the fast path and the pre-check (nothing committed yet), waits on C's row,
    // then finds no stock: only the rejection re-check can turn that into the replay.
    const { orderNumber, res } = await overlapWithOriginal(w, w.C, body, () =>
      post(app, body).then((r) => r),
    );

    expect(res.status, res.text).toBe(200);
    expect(parsed(res).orderNumber).toBe(orderNumber);
    expect(await prisma.order.count()).toBe(1);
    expect(await remaining(w.C)).toBe(0);
  });

  it('#22 overlap held open: a retry that reaches the insert after the original committed is replayed (§4 step 4)', async () => {
    const w = await seedOrderWorld();
    const { app } = makeApp();
    const body = batchBody(w, one(w.A));

    // A still has stock after the original, so the retry reserves and inserts: the unique
    // violation on client_request_id is what sends it to the original order.
    const { orderNumber, res } = await overlapWithOriginal(w, w.A, body, () =>
      post(app, body).then((r) => r),
    );

    expect(res.status, res.text).toBe(200);
    expect(parsed(res).orderNumber).toBe(orderNumber);
    expect(await prisma.order.count()).toBe(1);
    expect(await remaining(w.A)).toBe(4);
  });
});

describe('POST /api/orders — different customers at once (#23–#25)', () => {
  it('#23 last item, two customers: one 201, one OUT_OF_STOCK with available 0', async () => {
    const w = await seedOrderWorld();
    const { app } = makeApp();
    const bodies = [1, 2].map((i) => batchBody(w, one(w.C), { customerPhone: phoneN(i) }));

    const results = await Promise.all(bodies.map((b) => post(app, b)));

    expect(statuses(results), texts(results)).toEqual([201, 409]);
    const lost = results.find((r) => r.status === 409)!;
    expect(lost.body.error.code).toBe('OUT_OF_STOCK');
    expect(lost.body.error.details.items[0].available).toBe(0);
    expect(await prisma.order.count()).toBe(1);
    expect(await remaining(w.C)).toBe(0);
  });

  it('#24 ten buyers for five: exactly five 201 and five OUT_OF_STOCK', async () => {
    const w = await seedOrderWorld();
    const { app } = makeApp();
    const bodies = Array.from({ length: 10 }, (_, i) =>
      batchBody(w, one(w.A), { customerPhone: phoneN(i) }),
    );

    const results = await Promise.all(bodies.map((b) => post(app, b)));

    const won = results.filter((r) => r.status === 201);
    expect(won, texts(results)).toHaveLength(5);
    const lost = results.filter((r) => r.status !== 201);
    expect(lost).toHaveLength(5);
    for (const res of lost) {
      expect(res.status, res.text).toBe(409);
      expect(res.body.error.code).toBe('OUT_OF_STOCK');
    }
    expect(await prisma.order.count()).toBe(5);
    expect(await remaining(w.A)).toBe(0);
  });

  it('#25 opposite-order carts [A,B] / [B,A] at once: no deadlock, no retry, all sold', async () => {
    const w = await seedOrderWorld({ stock: { A: 20, B: 20 } });
    const { logger, lines } = captureLogger();
    const { app } = makeApp({ logger });
    const ab = [
      { menuItemId: w.A.id, quantity: 1 },
      { menuItemId: w.B.id, quantity: 1 },
    ];
    const bodies = Array.from({ length: 20 }, (_, i) =>
      batchBody(w, i % 2 === 0 ? ab : [...ab].reverse(), { customerPhone: phoneN(i) }),
    );

    const results = await Promise.all(bodies.map((b) => post(app, b)));

    for (const res of results) {
      expect([201, 409], res.text).toContain(res.status);
      if (res.status === 409) expect(res.body.error.code).toBe('OUT_OF_STOCK');
    }
    // Without the ascending lock order, Postgres would break a deadlock and the retry would hide it.
    expect(lines.filter((l) => l.msg === 'order.retry')).toEqual([]);
    expect(await prisma.order.count()).toBe(20);
    expect(await remaining(w.A)).toBe(0);
    expect(await remaining(w.B)).toBe(0);
  });

  it('#25 safety net: a real deadlock is retried once, with the first attempt\'s "now" (§4 step 6)', async () => {
    const w = await seedOrderWorld();
    const { logger, lines } = captureLogger();
    const { app, clock } = makeApp({ logger });
    const body = batchBody(w, [
      { menuItemId: w.A.id, quantity: 1 },
      { menuItemId: w.B.id, quantity: 1 },
    ]);
    const touch = (tx: Tx, id: number) =>
      tx.$executeRaw`UPDATE menu_items SET updated_at = now() WHERE id = ${id}`;
    // The order locks in ascending id order, so it takes A before it waits on B.
    expect(w.A.id).toBeLessThan(w.B.id);

    // Lock B, let the order lock A and wait on B, then reach for A: Postgres aborts the order's
    // attempt with 40P01. Meanwhile the clock passes MSH's 19:30 cutoff; the retry must still
    // decide with the instant the order arrived at (step 3.3: one "now" per order).
    const { res } = await holdOpen(async (tx, sent) => {
      await touch(tx, w.B.id);
      sent.pending = post(app, body).then((r) => r);
      await untilWaitingOnLock();
      clock.set(istInstant('19:30'));
      // The backend whose deadlock_timeout (1 s) fires first runs the check and is the one
      // aborted. Waiting 200 ms before closing the cycle makes that reliably the order's backend,
      // not this transaction.
      await sleep(200);
      await touch(tx, w.A.id);
    });

    expect(res.status, res.text).toBe(201);
    expect(parsed(res).createdAt).toBe(TEST_NOW);
    expect(lines.filter((l) => l.msg === 'order.retry')).toEqual([
      expect.objectContaining({ level: 'warn', reqId: res.headers['x-request-id'] }),
    ]);
    expect(await prisma.order.count()).toBe(1);
    expect([await remaining(w.A), await remaining(w.B)]).toEqual([4, 4]);
  });
});

describe('POST /api/orders — a replay after the world changed (Review Focus 1 and 3)', () => {
  it('D1 a replay ignores a changed body: original number and items, B untouched', async () => {
    const w = await seedOrderWorld();
    const { app } = makeApp();
    const body = batchBody(w, [{ menuItemId: w.A.id, quantity: 2 }]);
    const first = await post(app, body);
    expect(first.status, first.text).toBe(201);
    const original = parsed(first);

    const res = await post(app, {
      ...body,
      expectedTotal: 1,
      items: [{ menuItemId: w.B.id, quantity: 1 }],
    });

    expect(res.status, res.text).toBe(200);
    const replay = parsed(res);
    expect(replay.orderNumber).toBe(original.orderNumber);
    expect(replay.items).toEqual(original.items);
    expect(replay.total).toBe(300);
    expect(await prisma.order.count()).toBe(1);
    expect(await remaining(w.B)).toBe(5);
  });

  it('D2 orders paused after the order was placed: resending it is 200 replayed', async () => {
    const w = await seedOrderWorld();
    const { app } = makeApp();
    const body = batchBody(w, one(w.A));
    const first = await post(app, body);
    expect(first.status, first.text).toBe(201);
    await prisma.deliverySettings.update({ where: { id: 1 }, data: { ordersPaused: true } });

    const res = await post(app, body);

    expect(res.status, res.text).toBe(200);
    expect(parsed(res).orderNumber).toBe(parsed(first).orderNumber);
    expect(await prisma.order.count()).toBe(1);
  });
});
