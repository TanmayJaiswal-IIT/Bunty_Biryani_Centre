import type { z } from 'zod';
import type { ErrorCode } from './errors.js';
import type {
  deliveryOptionsSchema,
  deliverySlotOptionSchema,
  expressOptionsSchema,
} from './schemas/delivery.js';
import type { publicMenuItemSchema, publicMenuSchema } from './schemas/menu.js';
import type {
  createOrderResponseSchema,
  lookupSchema,
  publicOrderItemSchema,
  publicOrderViewSchema,
} from './schemas/order.js';

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

export type {
  DeliveryMode,
  ExpressUnavailableReason,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  SlotClosedReason,
} from './enums.js';
export type { CreateOrderInput, CreateOrderOutput } from './schemas/order.js';

/** `POST /api/orders` and `POST /api/orders/lookup` (Batch 1 §8.4, Batch 5 §4). */
export type PublicOrderItem = z.output<typeof publicOrderItemSchema>;
export type PublicOrderView = z.output<typeof publicOrderViewSchema>;
export type CreateOrderResponse = z.output<typeof createOrderResponseSchema>;
export type LookupOrderInput = z.input<typeof lookupSchema>;
export type LookupOrderOutput = z.output<typeof lookupSchema>;

export type {
  DashboardQueryInput,
  DashboardQueryOutput,
  OrdersQueryInput,
  OrdersQueryOutput,
  OrderAction,
  OrderActionInput,
  OrderActionOutput,
  CompleteManyInput,
  CompleteManyOutput,
  MenuItemCreateInput,
  MenuItemCreateOutput,
  MenuItemUpdateInput,
  MenuItemUpdateOutput,
  StockBulkInput,
  StockBulkOutput,
  LocationCreateInput,
  LocationCreateOutput,
  LocationUpdateInput,
  LocationUpdateOutput,
  SlotCreateInput,
  SlotCreateOutput,
  SlotUpdateInput,
  SlotUpdateOutput,
  SettingsUpdateInput,
  SettingsUpdateOutput,
} from './schemas/admin.js';

export type {
  AdminOrderView,
  Dashboard,
  DashboardBatch,
  DashboardView,
  AdminOrdersResponse,
  CompleteManyResult,
  AdminMenuItem,
  AdminMenuResponse,
  AdminLocation,
  AdminLocationsResponse,
  AdminSlot,
  AdminSlotsResponse,
  AdminSettings,
} from './schemas/admin-views.js';

