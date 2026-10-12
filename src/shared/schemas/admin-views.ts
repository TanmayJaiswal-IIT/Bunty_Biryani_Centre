import { z } from 'zod';
import { DELIVERY_MODES, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '../enums.js';
import { hhmmSchema } from './delivery.js';
import { ORDER_NUMBER_PATTERN } from './order.js';

// Admin response views (Batch 1 §8.5). Strict throughout, so a leaked column (`clientRequestId`,
// `updatedAt`, `closedOn`, a stock field on a view that should not carry one) or a missing field fails
// the parse in tests instead of reaching the browser. Types are derived in `api-types.ts`.

const id = z.number().int().positive();
/** Integer rupees (Rule 1). */
const money = z.number().int().min(0);
const count = z.number().int().min(0);
const instant = z.iso.datetime();
const mobile = z.string().regex(/^[6-9]\d{9}$/);

/** Used by the dashboard, the orders list and the order detail. The only view that carries the customer's phone. */
export const adminOrderViewSchema = z.strictObject({
  id,
  orderNumber: z.string().regex(ORDER_NUMBER_PATTERN),
  status: z.enum(ORDER_STATUSES),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  deliveryMode: z.enum(DELIVERY_MODES),
  /** IST business date, `YYYY-MM-DD`. */
  deliveryDate: z.iso.date(),
  locationId: id,
  locationName: z.string(),
  /** Null for express orders. */
  slotId: id.nullable(),
  slotDeliveryTime: hhmmSchema.nullable(),
  /** Set for express orders only. */
  expressWindow: z
    .strictObject({ from: hhmmSchema, to: hhmmSchema, etaText: z.string() })
    .nullable(),
  /** An open express order past the end of its window (Batch 1 E5). */
  isLate: z.boolean(),
  customerName: z.string(),
  customerPhone: z.string().regex(/^\d{10}$/),
  addressDetail: z.string().nullable(),
  items: z
    .array(
      z.strictObject({
        menuItemId: id,
        name: z.string(),
        unitPrice: money,
        quantity: z.number().int().min(1),
        lineTotal: money,
      }),
    )
    .min(1),
  /** Sum of quantities. */
  itemCount: z.number().int().min(1),
  foodSubtotal: money,
  deliveryFee: money,
  total: money,
  createdAt: instant,
  completedAt: instant.nullable(),
  cancelledAt: instant.nullable(),
  collectedAt: instant.nullable(),
});

// ---------- dashboard ----------

/** One batch group: a slot's orders for the date (Batch 1 §8.5). */
export const dashboardBatchSchema = z.strictObject({
  slotId: id,
  locationName: z.string(),
  deliveryTime: hhmmSchema,
  cutoffTime: hhmmSchema,
  /** The slot's time was changed after these orders were placed; `deliveryTime` is the snapshotted one. */
  slotTimeChanged: z.boolean(),
  isOpenNow: z.boolean(),
  closedToday: z.boolean(),
  /** Counts and totals below exclude cancelled orders. */
  orderCount: count,
  openCount: count,
  itemCount: count,
  codTotal: money,
  codPending: money,
  /** The packing list, largest quantity first. */
  itemBreakdown: z.array(
    z.strictObject({ menuItemId: id, name: z.string(), quantity: z.number().int().min(1) }),
  ),
  orders: z.array(adminOrderViewSchema),
});

export const dashboardSchema = z.strictObject({
  /** IST business date being viewed, `YYYY-MM-DD`. */
  date: z.iso.date(),
  isToday: z.boolean(),
  /** Server time of day in IST, `HH:mm`. */
  serverTime: hhmmSchema,
  controls: z.strictObject({
    ordersPaused: z.boolean(),
    expressEnabled: z.boolean(),
    expressAvailableNow: z.boolean(),
    /** Let the Express switch say "On · till 11:00 PM" or "On · opens 11:00 AM" (Batch 6 Decision 4). */
    expressOpensAt: hhmmSchema,
    expressClosesAt: hhmmSchema,
  }),
  stock: z.strictObject({
    itemsOnMenu: count,
    itemsWithoutStockToday: count,
  }),
  summary: z.strictObject({
    newOrders: count,
    completed: count,
    cancelled: count,
    codPending: money,
    codCollected: money,
    openOrdersFromEarlierDays: count,
  }),
  batches: z.array(dashboardBatchSchema),
  express: z.strictObject({
    activeCount: count,
    orders: z.array(adminOrderViewSchema),
  }),
  earlierOpenOrders: z.array(adminOrderViewSchema),
});

/** `GET /api/admin/orders`. */
export const adminOrdersResponseSchema = z.strictObject({
  orders: z.array(adminOrderViewSchema),
});

/** `POST /api/admin/orders/complete-many`: how many orders actually changed. */
export const completeManyResultSchema = z.strictObject({
  completed: count,
  collected: count,
});

// ---------- menu, stock, locations, slots, settings ----------

export const adminMenuItemSchema = z.strictObject({
  id,
  name: z.string(),
  description: z.string().nullable(),
  price: money,
  imageUrl: z.string().nullable(),
  isAvailable: z.boolean(),
  sortOrder: z.number().int(),
  dailyStock: count,
  stockRemaining: count,
  /** The business date the stock was set for; null until it is first set. */
  stockDate: z.iso.date().nullable(),
  /** `stockDate` is today. Stock from another day counts as none. */
  stockSetToday: z.boolean(),
  /** `dailyStock - stockRemaining` when set today, otherwise 0. */
  soldToday: count,
});

/** `GET /api/admin/menu` and `PUT /api/admin/stock`. */
export const adminMenuResponseSchema = z.strictObject({
  items: z.array(adminMenuItemSchema),
});

export const adminLocationSchema = z.strictObject({
  id,
  name: z.string(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  /** Active slots only. */
  slotCount: count,
});

export const adminSlotSchema = z.strictObject({
  id,
  locationId: id,
  locationName: z.string(),
  deliveryTime: hhmmSchema,
  cutoffTime: hhmmSchema,
  isActive: z.boolean(),
  closedToday: z.boolean(),
  /** Today's open (ORDER_RECEIVED) orders on this slot. */
  openOrdersToday: count,
});

/** Every `DeliverySettings` field except `id` and `updatedAt` (Batch 6 Decision 19). */
export const adminSettingsSchema = z.strictObject({
  ordersPaused: z.boolean(),
  expressEnabled: z.boolean(),
  expressFee: money,
  expressEtaMinMinutes: count,
  expressEtaMaxMinutes: count,
  expressOpensAt: hhmmSchema,
  expressClosesAt: hhmmSchema,
  batchFee: money,
  /** Help number shown to customers, 10 digits, or null when not configured. */
  contactPhone: mobile.nullable(),
});
