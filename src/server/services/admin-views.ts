import type { Prisma } from '../db.js';
import { fromDbDate } from '../lib/db-date.js';
import {
  adminOrderViewSchema,
  type AdminOrderView,
  adminMenuItemSchema,
  type AdminMenuItem,
  adminSlotSchema,
  type AdminSlot,
  adminSettingsSchema,
  type AdminSettings,
} from '../../shared/schemas/admin-views.js';
import { expressWindowFor } from './order.service.js';

export type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

/**
 * Transforms an internal Order row into the strict AdminOrderView (Batch 1 §8.5).
 */
export function toAdminOrderView(order: OrderWithItems, now: Date): AdminOrderView {
  const sortedItems = [...order.items].sort((a, b) => a.id - b.id);

  const isLate =
    order.deliveryMode === 'EXPRESS' &&
    order.status === 'ORDER_RECEIVED' &&
    order.expressEtaMaxMinutes !== null &&
    now.getTime() > order.createdAt.getTime() + order.expressEtaMaxMinutes * 60_000;

  const view = {
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
    items: sortedItems.map((i) => ({
      menuItemId: i.menuItemId,
      name: i.itemName,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    itemCount: sortedItems.reduce((sum, i) => sum + i.quantity, 0),
    foodSubtotal: order.foodSubtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    createdAt: order.createdAt.toISOString(),
    completedAt: order.completedAt ? order.completedAt.toISOString() : null,
    cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : null,
    collectedAt: order.collectedAt ? order.collectedAt.toISOString() : null,
  };

  return adminOrderViewSchema.parse(view);
}

export type MenuItemRow = Prisma.MenuItemGetPayload<Record<string, never>>;

/**
 * Maps a MenuItem row to AdminMenuItem view.
 * stockSetToday is true iff the stored stockDate matches businessDate.
 * soldToday is dailyStock - stockRemaining if stock was set today, else 0.
 */
export function toAdminMenuItem(row: MenuItemRow, businessDate: string): AdminMenuItem {
  const stockDateStr = row.stockDate ? fromDbDate(row.stockDate) : null;
  const stockSetToday = stockDateStr === businessDate;
  const soldToday = stockSetToday ? row.dailyStock - row.stockRemaining : 0;

  const view = {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price,
    imageUrl: row.imageUrl,
    isAvailable: row.isAvailable,
    sortOrder: row.sortOrder,
    dailyStock: row.dailyStock,
    stockRemaining: row.stockRemaining,
    stockDate: stockDateStr,
    stockSetToday,
    soldToday,
  };

  return adminMenuItemSchema.parse(view);
}

export type SlotWithLocation = Prisma.DeliverySlotGetPayload<{ include: { location: true } }>;

/**
 * Maps a DeliverySlot row with its location to AdminSlot view.
 */
export function toAdminSlot(
  row: SlotWithLocation,
  businessDate: string,
  openOrdersToday: number,
): AdminSlot {
  const closedToday = row.closedOn ? fromDbDate(row.closedOn) === businessDate : false;

  const view = {
    id: row.id,
    locationId: row.locationId,
    locationName: row.location.name,
    deliveryTime: row.deliveryTime,
    cutoffTime: row.cutoffTime,
    isActive: row.isActive,
    closedToday,
    openOrdersToday,
  };

  return adminSlotSchema.parse(view);
}

export type DeliverySettingsRow = Prisma.DeliverySettingsGetPayload<Record<string, never>>;

/**
 * Maps a DeliverySettings row to AdminSettings view (excludes id and updatedAt).
 */
export function toAdminSettings(row: DeliverySettingsRow): AdminSettings {
  const view = {
    ordersPaused: row.ordersPaused,
    expressEnabled: row.expressEnabled,
    expressFee: row.expressFee,
    batchFee: row.batchFee,
    expressEtaMinMinutes: row.expressEtaMinMinutes,
    expressEtaMaxMinutes: row.expressEtaMaxMinutes,
    expressOpensAt: row.expressOpensAt,
    expressClosesAt: row.expressClosesAt,
    contactPhone: row.contactPhone,
  };

  return adminSettingsSchema.parse(view);
}
