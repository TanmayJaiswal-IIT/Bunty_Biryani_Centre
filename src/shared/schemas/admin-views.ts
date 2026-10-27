import { z } from 'zod';
import {
  DELIVERY_MODES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '../enums.js';
import { hhmmSchema } from './delivery.js';
import { expressWindowSchema } from './order.js';

export const adminOrderViewSchema = z.strictObject({
  id: z.number().int().positive(),
  orderNumber: z.string().regex(/^BB\d{4,9}$/),
  status: z.enum(ORDER_STATUSES),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  deliveryMode: z.enum(DELIVERY_MODES),
  deliveryDate: z.iso.date(),
  locationId: z.number().int().positive(),
  locationName: z.string(),
  slotId: z.number().int().positive().nullable(),
  slotDeliveryTime: hhmmSchema.nullable(),
  expressWindow: expressWindowSchema.nullable(),
  isLate: z.boolean(),
  customerName: z.string(),
  customerPhone: z.string().regex(/^[6-9]\d{9}$/),
  addressDetail: z.string().nullable(),
  items: z.array(
    z.strictObject({
      menuItemId: z.number().int().positive(),
      name: z.string(),
      unitPrice: z.number().int().nonnegative(),
      quantity: z.number().int().positive(),
      lineTotal: z.number().int().nonnegative(),
    }),
  ),
  itemCount: z.number().int().nonnegative(),
  foodSubtotal: z.number().int().nonnegative(),
  deliveryFee: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  collectedAt: z.iso.datetime().nullable(),
});
export type AdminOrderView = z.output<typeof adminOrderViewSchema>;

export const dashboardBatchSchema = z.strictObject({
  slotId: z.number().int().positive(),
  locationName: z.string(),
  deliveryTime: hhmmSchema,
  cutoffTime: hhmmSchema,
  slotTimeChanged: z.boolean(),
  isOpenNow: z.boolean(),
  closedToday: z.boolean(),
  orderCount: z.number().int().nonnegative(),
  openCount: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  codTotal: z.number().int().nonnegative(),
  codPending: z.number().int().nonnegative(),
  itemBreakdown: z.array(
    z.strictObject({
      menuItemId: z.number().int().positive(),
      name: z.string(),
      quantity: z.number().int().positive(),
    }),
  ),
  orders: z.array(adminOrderViewSchema),
});
export type DashboardBatch = z.output<typeof dashboardBatchSchema>;

export const dashboardSchema = z.strictObject({
  date: z.iso.date(),
  isToday: z.boolean(),
  serverTime: hhmmSchema,
  controls: z.strictObject({
    ordersPaused: z.boolean(),
    expressEnabled: z.boolean(),
    expressAvailableNow: z.boolean(),
    expressOpensAt: hhmmSchema,
    expressClosesAt: hhmmSchema,
  }),
  stock: z.strictObject({
    itemsOnMenu: z.number().int().nonnegative(),
    itemsWithoutStockToday: z.number().int().nonnegative(),
  }),
  summary: z.strictObject({
    newOrders: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    codPending: z.number().int().nonnegative(),
    codCollected: z.number().int().nonnegative(),
    openOrdersFromEarlierDays: z.number().int().nonnegative(),
  }),
  batches: z.array(dashboardBatchSchema),
  express: z.strictObject({
    activeCount: z.number().int().nonnegative(),
    orders: z.array(adminOrderViewSchema),
  }),
  earlierOpenOrders: z.array(adminOrderViewSchema),
});
export type Dashboard = z.output<typeof dashboardSchema>;
export type DashboardView = Dashboard;

export const adminOrdersResponseSchema = z.strictObject({
  orders: z.array(adminOrderViewSchema),
});
export type AdminOrdersResponse = z.output<typeof adminOrdersResponseSchema>;

export const completeManyResultSchema = z.strictObject({
  completed: z.number().int().nonnegative(),
  collected: z.number().int().nonnegative(),
});
export type CompleteManyResult = z.output<typeof completeManyResultSchema>;

export const adminMenuItemSchema = z.strictObject({
  id: z.number().int().positive(),
  name: z.string(),
  description: z.string().nullable(),
  price: z.number().int().positive(),
  imageUrl: z.string().nullable(),
  isAvailable: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  dailyStock: z.number().int().nonnegative(),
  stockRemaining: z.number().int().nonnegative(),
  stockDate: z.iso.date().nullable(),
  stockSetToday: z.boolean(),
  soldToday: z.number().int().nonnegative(),
});
export type AdminMenuItem = z.output<typeof adminMenuItemSchema>;

export const adminMenuResponseSchema = z.strictObject({
  items: z.array(adminMenuItemSchema),
});
export type AdminMenuResponse = z.output<typeof adminMenuResponseSchema>;

export const adminLocationSchema = z.strictObject({
  id: z.number().int().positive(),
  name: z.string(),
  isActive: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  slotCount: z.number().int().nonnegative(),
});
export type AdminLocation = z.output<typeof adminLocationSchema>;

export const adminLocationsResponseSchema = z.strictObject({
  locations: z.array(adminLocationSchema),
});
export type AdminLocationsResponse = z.output<typeof adminLocationsResponseSchema>;

export const adminSlotSchema = z.strictObject({
  id: z.number().int().positive(),
  locationId: z.number().int().positive(),
  locationName: z.string(),
  deliveryTime: hhmmSchema,
  cutoffTime: hhmmSchema,
  isActive: z.boolean(),
  closedToday: z.boolean(),
  openOrdersToday: z.number().int().nonnegative(),
});
export type AdminSlot = z.output<typeof adminSlotSchema>;

export const adminSlotsResponseSchema = z.strictObject({
  slots: z.array(adminSlotSchema),
});
export type AdminSlotsResponse = z.output<typeof adminSlotsResponseSchema>;

export const adminSettingsSchema = z.strictObject({
  ordersPaused: z.boolean(),
  expressEnabled: z.boolean(),
  expressFee: z.number().int().nonnegative(),
  batchFee: z.number().int().nonnegative(),
  expressEtaMinMinutes: z.number().int().positive(),
  expressEtaMaxMinutes: z.number().int().positive(),
  expressOpensAt: hhmmSchema,
  expressClosesAt: hhmmSchema,
  contactPhone: z
    .string()
    .regex(/^[6-9]\d{9}$/)
    .nullable(),
});
export type AdminSettings = z.output<typeof adminSettingsSchema>;
