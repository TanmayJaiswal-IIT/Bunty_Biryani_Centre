import type { OrderStatus, PaymentStatus } from '../../shared/enums.js';
import type { Prisma } from '../db.js';
import { AppError } from '../lib/app-error.js';
import { fromDbDate } from '../lib/db-date.js';
import { restoreStockForOrder } from './inventory.service.js';

export type OrderAction = { status: OrderStatus } | { paymentStatus: PaymentStatus };
export type Verdict = 'APPLY' | 'NOOP' | 'INVALID';

/**
 * Evaluates whether an order action can be applied given current status & paymentStatus.
 * Pure function covering all 25 cells of the state machine transition table (Spec §4).
 */
export function canApply(
  order: { status: OrderStatus; paymentStatus: PaymentStatus },
  action: OrderAction,
): Verdict {
  if ('status' in action) {
    const target = action.status;
    if (order.status === 'CANCELLED') {
      return target === 'CANCELLED' ? 'NOOP' : 'INVALID';
    }
    if (target === 'CANCELLED') {
      if (order.paymentStatus === 'COLLECTED') return 'INVALID';
      if (order.status === 'COMPLETED') return 'INVALID';
      return 'APPLY';
    }
    if (target === 'COMPLETED') {
      return order.status === 'COMPLETED' ? 'NOOP' : 'APPLY';
    }
    if (target === 'ORDER_RECEIVED') {
      return order.status === 'ORDER_RECEIVED' ? 'NOOP' : 'APPLY';
    }
  }

  if ('paymentStatus' in action) {
    const target = action.paymentStatus;
    if (order.status === 'CANCELLED') {
      return target === 'PENDING' ? 'NOOP' : 'INVALID';
    }
    if (target === 'COLLECTED') {
      return order.paymentStatus === 'COLLECTED' ? 'NOOP' : 'APPLY';
    }
    if (target === 'PENDING') {
      return order.paymentStatus === 'PENDING' ? 'NOOP' : 'APPLY';
    }
  }

  return 'INVALID';
}

/**
 * Locks the order row first (FOR UPDATE) and applies the requested action.
 * Spec §4 steps 1–4. Cancel restores stock via inventory.service.js.
 */
export async function applyOrderAction(
  tx: Prisma.TransactionClient,
  orderId: number,
  action: OrderAction,
  now: Date,
): Promise<{ changed: boolean }> {
  const rows = await tx.$queryRaw<
    { id: number; status: OrderStatus; payment_status: PaymentStatus; delivery_date: Date }[]
  >`SELECT id, status, payment_status, delivery_date FROM orders WHERE id = ${orderId} FOR UPDATE`;

  if (rows.length === 0) {
    throw new AppError('NOT_FOUND', 'Order not found.');
  }

  const row = rows[0]!;
  const currentOrder = {
    status: row.status,
    paymentStatus: row.payment_status,
  };

  const verdict = canApply(currentOrder, action);

  if (verdict === 'NOOP') {
    return { changed: false };
  }

  if (verdict === 'INVALID') {
    if ('status' in action && action.status === 'CANCELLED') {
      if (currentOrder.paymentStatus === 'COLLECTED') {
        throw new AppError('INVALID_TRANSITION', 'Undo cash collected before cancelling.', {
          from: currentOrder.paymentStatus,
          to: action.status,
        });
      }
      if (currentOrder.status === 'COMPLETED') {
        throw new AppError('INVALID_TRANSITION', 'Reopen the order before cancelling.', {
          from: currentOrder.status,
          to: action.status,
        });
      }
    }
    if (currentOrder.status === 'CANCELLED') {
      const to = 'status' in action ? action.status : action.paymentStatus;
      throw new AppError('INVALID_TRANSITION', 'This order was cancelled.', {
        from: currentOrder.status,
        to,
      });
    }
    const from = 'status' in action ? currentOrder.status : currentOrder.paymentStatus;
    const to = 'status' in action ? action.status : action.paymentStatus;
    throw new AppError('INVALID_TRANSITION', 'Invalid transition.', { from, to });
  }

  if ('status' in action) {
    if (action.status === 'COMPLETED') {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'COMPLETED', completedAt: now },
      });
    } else if (action.status === 'ORDER_RECEIVED') {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'ORDER_RECEIVED', completedAt: null },
      });
    } else if (action.status === 'CANCELLED') {
      const items = await tx.orderItem.findMany({
        where: { orderId },
        select: { menuItemId: true, quantity: true },
      });
      await restoreStockForOrder(tx, {
        deliveryDate: fromDbDate(row.delivery_date),
        items,
      });
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
    }
  } else if ('paymentStatus' in action) {
    if (action.paymentStatus === 'COLLECTED') {
      await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: 'COLLECTED', collectedAt: now },
      });
    } else if (action.paymentStatus === 'PENDING') {
      await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: 'PENDING', collectedAt: null },
      });
    }
  }

  return { changed: true };
}
