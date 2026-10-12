import type { AdminOrderView } from '../../shared/api-types.js';
import type { Prisma } from '../db.js';
import { fromDbDate } from '../lib/db-date.js';
import { expressWindowFor } from './order.service.js';

// Response mappers for the admin API (Batch 1 §8.5). Fields are picked one by one, so a new column
// never reaches the browser by accident (`clientRequestId`, `updatedAt`). The mappers are kept apart
// from the services that write menu items, so those files never need to name a stock column.

/** An order row with its items, as `include: { items: true }` returns it. */
export type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

/**
 * The one admin view of an order, used by the dashboard, the list and the detail. Items follow
 * `order_items.id` (the cart order). `isLate` is Batch 1 E5: an express order that is still open
 * after `createdAt + its max ETA`, judged on `now`, the server clock read once per request.
 */
export function toAdminOrderView(order: OrderWithItems, now: Date): AdminOrderView {
  const items = [...order.items]
    .sort((a, b) => a.id - b.id)
    .map((item) => ({
      menuItemId: item.menuItemId,
      name: item.itemName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    }));
  const maxEta = order.expressEtaMaxMinutes;
  const isLate =
    order.deliveryMode === 'EXPRESS' &&
    order.status === 'ORDER_RECEIVED' &&
    maxEta !== null &&
    now.getTime() > order.createdAt.getTime() + maxEta * 60_000;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    deliveryMode: order.deliveryMode,
    deliveryDate: fromDbDate(order.deliveryDate),
    locationId: order.locationId,
    locationName: order.locationName,
    slotId: order.slotId,
    slotDeliveryTime: order.slotDeliveryTime,
    expressWindow: expressWindowFor(order),
    isLate,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    addressDetail: order.addressDetail,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    foodSubtotal: order.foodSubtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    createdAt: order.createdAt.toISOString(),
    completedAt: order.completedAt?.toISOString() ?? null,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    collectedAt: order.collectedAt?.toISOString() ?? null,
  };
}
