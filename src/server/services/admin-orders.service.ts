import type { AdminOrderView } from '../../shared/api-types.js';
import type { CompleteManyOutput } from '../../shared/schemas/admin.js';
import type { Clock } from '../../shared/time.js';
import { Prisma, type PrismaClient } from '../db.js';
import { AppError } from '../lib/app-error.js';
import { toAdminOrderView } from './admin-views.js';
import { applyOrderAction, type OrderAction } from './status-machine.js';

// The admin side of orders (Batch 6 §4, §6). Single-order detail and status changes, and the
// batch "mark all done". Every change goes through the status machine, in one transaction.
// `clock.now()` is read once per request and is the source of every timestamp written.

export interface AdminDeps {
  prisma: PrismaClient;
  clock: Clock;
}

/** Same as order creation: Read Committed, with a bounded wait for locks. */
export const ADMIN_TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 5_000,
  timeout: 10_000,
};

const ORDER_NOT_FOUND = 'Order not found.';

/** `GET /api/admin/orders/:id`. */
export async function getAdminOrder(deps: AdminDeps, id: number): Promise<AdminOrderView> {
  const now = deps.clock.now();
  const order = await deps.prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!order) throw new AppError('NOT_FOUND', ORDER_NOT_FOUND);
  return toAdminOrderView(order, now);
}

/**
 * `PATCH /api/admin/orders/:id/status`. The action and the reload run in one transaction, so the
 * response is the order as this request left it, including when the request was a no-op.
 */
export async function updateOrderStatus(
  deps: AdminDeps,
  id: number,
  action: OrderAction,
): Promise<AdminOrderView> {
  const now = deps.clock.now();
  return deps.prisma.$transaction(async (tx) => {
    await applyOrderAction(tx, id, action, now);
    const order = await tx.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
    return toAdminOrderView(order, now);
  }, ADMIN_TX_OPTIONS);
}

/**
 * `POST /api/admin/orders/complete-many` (Batch 1 §8.5): complete each listed order, and mark its
 * cash collected if asked, in ascending id order and one transaction, so one bad id (unknown:
 * `404`, cancelled: `409`) leaves every order as it was. Orders already in the requested state are
 * no-ops; the counts are the orders that actually changed.
 */
export async function completeMany(
  deps: AdminDeps,
  input: CompleteManyOutput,
): Promise<{ completed: number; collected: number }> {
  const now = deps.clock.now();
  const ids = [...input.orderIds].sort((a, b) => a - b);
  return deps.prisma.$transaction(async (tx) => {
    let completed = 0;
    let collected = 0;
    for (const id of ids) {
      if ((await applyOrderAction(tx, id, { status: 'COMPLETED' }, now)).changed) completed++;
      if (
        input.markCollected &&
        (await applyOrderAction(tx, id, { paymentStatus: 'COLLECTED' }, now)).changed
      ) {
        collected++;
      }
    }
    return { completed, collected };
  }, ADMIN_TX_OPTIONS);
}
