import { Prisma, type PrismaClient } from '../db.js';
import { AppError } from '../lib/app-error.js';
import { nowIST, type Clock } from '../../shared/time.js';
import { toDbDate } from '../lib/db-date.js';
import { ADMIN_ORDERS_LIMIT } from '../../shared/limits.js';
import { normalizeIndianMobile } from '../../shared/phone.js';
import type { AdminOrderView } from '../../shared/schemas/admin-views.js';
import type { CompleteManyOutput, OrdersQueryOutput } from '../../shared/schemas/admin.js';
import { applyOrderAction, type OrderAction } from './status-machine.js';
import { toAdminOrderView } from './admin-views.js';

export interface AdminDeps {
  prisma: PrismaClient;
  clock: Clock;
}

export const ADMIN_TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 5_000,
  timeout: 10_000,
};

export interface OrderSearch {
  orderNumber: string | null;
  phone: { exact: string } | { suffix: string } | null;
}

/**
 * Parses an admin search query string.
 * Decision 18. null -> no possible match (handler returns { orders: [] }).
 */
export function parseOrderQuery(q: string): OrderSearch | null {
  const trimmed = q.trim();
  if (!trimmed) return null;

  // 1. BB-prefixed order number: BB\d{4,9} (case-insensitive)
  const bbMatch = /^bb(\d{4,9})$/i.exec(trimmed);
  if (bbMatch) {
    return { orderNumber: `BB${bbMatch[1]}`, phone: null };
  }
  if (/^bb/i.test(trimmed)) {
    return null;
  }

  // 2. Bare digits: 4–10 digits
  if (/^\d+$/.test(trimmed)) {
    if (trimmed.length >= 4 && trimmed.length <= 9) {
      return {
        orderNumber: `BB${trimmed}`,
        phone: { suffix: trimmed },
      };
    }
    if (trimmed.length === 10) {
      return {
        orderNumber: null,
        phone: { suffix: trimmed },
      };
    }
    return null;
  }

  // 3. Formatted phone number: e.g. +91 98765-43210
  const normalized = normalizeIndianMobile(trimmed);
  if (normalized) {
    return {
      orderNumber: null,
      phone: { exact: normalized },
    };
  }

  return null;
}

/**
 * Lists orders matching filters or search query for admin.
 */
export async function listOrders(
  deps: AdminDeps,
  query: OrdersQueryOutput,
): Promise<{ orders: AdminOrderView[] }> {
  const now = deps.clock.now();
  const where: Prisma.OrderWhereInput = {};

  if (query.mode) {
    where.deliveryMode = query.mode;
  }
  if (query.status) {
    where.status = query.status;
  }
  if (query.slotId) {
    where.slotId = query.slotId;
  }

  if (query.q) {
    const search = parseOrderQuery(query.q);
    if (!search) {
      return { orders: [] };
    }

    const conditions: Prisma.OrderWhereInput[] = [];
    if (search.orderNumber) {
      conditions.push({ orderNumber: search.orderNumber });
    }
    if (search.phone) {
      if ('exact' in search.phone) {
        conditions.push({ customerPhone: search.phone.exact });
      } else {
        conditions.push({ customerPhone: { endsWith: search.phone.suffix } });
      }
    }

    if (conditions.length === 1) {
      Object.assign(where, conditions[0]);
    } else if (conditions.length > 1) {
      where.OR = conditions;
    }
  } else {
    const targetDate = query.date ?? nowIST(deps.clock).date;
    where.deliveryDate = toDbDate(targetDate);
  }

  const rows = await deps.prisma.order.findMany({
    where,
    include: { items: { orderBy: { id: 'asc' } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit ?? ADMIN_ORDERS_LIMIT,
  });

  return {
    orders: rows.map((row) => toAdminOrderView(row, now)),
  };
}

/**
 * Loads a single order detail view for admin.
 */
export async function getAdminOrder(deps: AdminDeps, id: number): Promise<AdminOrderView> {
  const order = await deps.prisma.order.findUnique({
    where: { id },
    include: { items: { orderBy: { id: 'asc' } } },
  });
  if (!order) {
    throw new AppError('NOT_FOUND', 'Order not found.');
  }
  return toAdminOrderView(order, deps.clock.now());
}

/**
 * Updates an order status or payment status via the status-machine.
 */
export async function updateOrderStatus(
  deps: AdminDeps,
  id: number,
  action: OrderAction,
): Promise<AdminOrderView> {
  const now = deps.clock.now();
  const updatedOrder = await deps.prisma.$transaction(async (tx) => {
    await applyOrderAction(tx, id, action, now);
    const order = await tx.order.findUnique({
      where: { id },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    if (!order) {
      throw new AppError('NOT_FOUND', 'Order not found.');
    }
    return order;
  }, ADMIN_TX_OPTIONS);

  return toAdminOrderView(updatedOrder, now);
}

/**
 * Completes multiple orders in ascending ID order in one transaction.
 */
export async function completeMany(
  deps: AdminDeps,
  input: CompleteManyOutput,
): Promise<{ completed: number; collected: number }> {
  const now = deps.clock.now();
  const sortedIds = [...input.orderIds].sort((a, b) => a - b);
  let completed = 0;
  let collected = 0;

  await deps.prisma.$transaction(async (tx) => {
    for (const orderId of sortedIds) {
      const resStatus = await applyOrderAction(tx, orderId, { status: 'COMPLETED' }, now);
      if (resStatus.changed) completed += 1;

      if (input.markCollected) {
        const resPayment = await applyOrderAction(tx, orderId, { paymentStatus: 'COLLECTED' }, now);
        if (resPayment.changed) collected += 1;
      }
    }
  }, ADMIN_TX_OPTIONS);

  return { completed, collected };
}
