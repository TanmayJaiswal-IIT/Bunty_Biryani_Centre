import type { OrderStatus, PaymentStatus } from '../../shared/enums.js';
import type { OrderAction } from '../../shared/schemas/admin.js';
import type { Prisma } from '../db.js';
import { AppError } from '../lib/app-error.js';
import { fromDbDate } from '../lib/db-date.js';
import { restoreStockForOrder } from './inventory.service.js';

// The only module that changes an order's `status`, `paymentStatus`, `completedAt`, `cancelledAt` or
// `collectedAt` (Batch 6 §4, Batch 1 §6.9 L1-L5). Every caller passes its own transaction. The order
// row is locked first (`FOR UPDATE`), then the stock rows ascending inside inventory.service, which
// is the project-wide lock order. A request for the state the order is already in is a no-op, so a
// double tap or two devices change nothing twice (stock is restored once).

type Tx = Prisma.TransactionClient;

export type { OrderAction };

/** `APPLY` changes the order, `NOOP` is already the requested state, `INVALID` is refused (409). */
export type Verdict = 'APPLY' | 'NOOP' | 'INVALID';

interface OrderState {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
}

/**
 * The transition table of Batch 6 §4. `CANCELLED` is terminal: only asking for cancel again (a
 * no-op) or the payment status it already has is accepted. A cancel needs the order open
 * (`ORDER_RECEIVED`, so a completed one is reopened first) and its cash not collected.
 */
export function canApply(order: OrderState, action: OrderAction): Verdict {
  if ('status' in action) {
    const target = action.status;
    if (order.status === 'CANCELLED') return target === 'CANCELLED' ? 'NOOP' : 'INVALID';
    if (target === order.status) return 'NOOP';
    if (target === 'CANCELLED') {
      return order.status === 'ORDER_RECEIVED' && order.paymentStatus === 'PENDING'
        ? 'APPLY'
        : 'INVALID';
    }
    return 'APPLY';
  }

  const target = action.paymentStatus;
  if (target === order.paymentStatus) return 'NOOP';
  return order.status === 'CANCELLED' ? 'INVALID' : 'APPLY';
}

const CANCELLED_MESSAGE = 'This order was cancelled.';

/**
 * The `409 INVALID_TRANSITION` for a refused action. The messages are written for the vendor: the
 * admin UI shows them as they are. `from` is the state in the way. For a cancel that is the
 * collected cash (checked first, so the vendor undoes it, then reopens) or the completed status.
 */
function invalidTransition(order: OrderState, action: OrderAction): AppError {
  if ('paymentStatus' in action) {
    return new AppError('INVALID_TRANSITION', CANCELLED_MESSAGE, {
      from: order.paymentStatus,
      to: action.paymentStatus,
    });
  }
  const to = action.status;
  if (order.status === 'CANCELLED') {
    return new AppError('INVALID_TRANSITION', CANCELLED_MESSAGE, { from: order.status, to });
  }
  if (order.paymentStatus === 'COLLECTED') {
    return new AppError('INVALID_TRANSITION', 'Undo cash collected before cancelling.', {
      from: order.paymentStatus,
      to,
    });
  }
  return new AppError('INVALID_TRANSITION', 'Reopen the order before cancelling.', {
    from: order.status,
    to,
  });
}

/** The column changes for an action that `canApply` accepted. */
function changesFor(action: OrderAction, now: Date): Prisma.OrderUpdateInput {
  if ('status' in action) {
    switch (action.status) {
      case 'COMPLETED':
        return { status: 'COMPLETED', completedAt: now };
      case 'ORDER_RECEIVED':
        return { status: 'ORDER_RECEIVED', completedAt: null };
      case 'CANCELLED':
        return { status: 'CANCELLED', cancelledAt: now };
    }
  }
  return action.paymentStatus === 'COLLECTED'
    ? { paymentStatus: 'COLLECTED', collectedAt: now }
    : { paymentStatus: 'PENDING', collectedAt: null };
}

interface LockedOrder {
  id: number;
  status: OrderStatus;
  payment_status: PaymentStatus;
  delivery_date: Date;
}

/**
 * Batch 6 §4 steps 1-4. Locks the order row, decides with `canApply`, then writes the change and its
 * timestamp (`now` is the caller's single reading of the clock). A cancel puts the items back into
 * stock first, through `restoreStockForOrder`, which touches only stock held for the order's own
 * delivery date. Unknown order: `NOT_FOUND`. Refused: `INVALID_TRANSITION { from, to }`.
 * Returns whether anything changed; the caller reloads the order when it needs it.
 */
export async function applyOrderAction(
  tx: Tx,
  orderId: number,
  action: OrderAction,
  now: Date,
): Promise<{ changed: boolean }> {
  const [row] = await tx.$queryRaw<LockedOrder[]>`
    SELECT id, status, payment_status, delivery_date
      FROM orders
     WHERE id = ${orderId}
       FOR UPDATE`;
  if (!row) throw new AppError('NOT_FOUND', 'Order not found.');

  const state: OrderState = { status: row.status, paymentStatus: row.payment_status };
  const verdict = canApply(state, action);
  if (verdict === 'NOOP') return { changed: false };
  if (verdict === 'INVALID') throw invalidTransition(state, action);

  if ('status' in action && action.status === 'CANCELLED') {
    const items = await tx.orderItem.findMany({
      where: { orderId },
      select: { menuItemId: true, quantity: true },
    });
    await restoreStockForOrder(tx, { deliveryDate: fromDbDate(row.delivery_date), items });
  }

  await tx.order.update({ where: { id: orderId }, data: changesFor(action, now) });
  return { changed: true };
}
