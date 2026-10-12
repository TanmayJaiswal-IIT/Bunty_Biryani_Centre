import type { z } from 'zod';
import type { ErrorCode } from './errors.js';
import type {
  adminLocationSchema,
  adminMenuItemSchema,
  adminMenuResponseSchema,
  adminOrdersResponseSchema,
  adminOrderViewSchema,
  adminSettingsSchema,
  adminSlotSchema,
  completeManyResultSchema,
  dashboardBatchSchema,
  dashboardSchema,
} from './schemas/admin-views.js';
import type {
  deliveryOptionsSchema,
  deliverySlotOptionSchema,
  expressOptionsSchema,
} from './schemas/delivery.js';
import type { publicMenuItemSchema, publicMenuSchema } from './schemas/menu.js';
import type { createOrderResponseSchema, publicOrderViewSchema } from './schemas/order.js';

/** Every API error looks like this (Batch 1 §8.1). `message` is safe to show to a customer. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** Response of `POST /api/admin/login` and `GET /api/admin/me`. */
export interface AdminSession {
  username: string;
}

export interface HealthResponse {
  status: 'ok' | 'error';
}

/** `GET /api/menu` (Batch 1 §8.4). Derived from the zod schema so the two cannot drift. */
export type PublicMenuItem = z.output<typeof publicMenuItemSchema>;
export type PublicMenu = z.output<typeof publicMenuSchema>;

/** `GET /api/delivery-options` (Batch 1 §8.4). */
export type DeliveryOptions = z.output<typeof deliveryOptionsSchema>;
export type DeliverySlotOption = z.output<typeof deliverySlotOptionSchema>;
export type ExpressOptions = z.output<typeof expressOptionsSchema>;

/** `POST /api/orders` and `POST /api/orders/lookup` (Batch 1 §8.4). */
export type PublicOrderView = z.output<typeof publicOrderViewSchema>;
export type PublicOrderItem = PublicOrderView['items'][number];
export type CreateOrderResponse = z.output<typeof createOrderResponseSchema>;

/** Admin order view: dashboard, orders list and order detail (Batch 1 §8.5). */
export type AdminOrderView = z.output<typeof adminOrderViewSchema>;
export type AdminOrderItem = AdminOrderView['items'][number];
export type AdminOrdersResponse = z.output<typeof adminOrdersResponseSchema>;

/** `GET /api/admin/dashboard`. */
export type Dashboard = z.output<typeof dashboardSchema>;
export type DashboardBatch = z.output<typeof dashboardBatchSchema>;

/** `POST /api/admin/orders/complete-many`. */
export type CompleteManyResult = z.output<typeof completeManyResultSchema>;

/** Admin menu, stock, locations, delivery slots and settings (Batch 1 §8.5). */
export type AdminMenuItem = z.output<typeof adminMenuItemSchema>;
export type AdminMenuResponse = z.output<typeof adminMenuResponseSchema>;
export type AdminLocation = z.output<typeof adminLocationSchema>;
export type AdminSlot = z.output<typeof adminSlotSchema>;
export type AdminSettings = z.output<typeof adminSettingsSchema>;
