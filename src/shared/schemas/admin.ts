import { z } from 'zod';
import {
  DELIVERY_MODES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
} from '../enums.js';
import {
  ADMIN_ORDERS_LIMIT,
  ADMIN_SEARCH_MAX,
  COMPLETE_MANY_MAX,
  ETA_MINUTES_MAX,
  ETA_MINUTES_MIN,
  FEE_MAX,
  IMAGE_URL_MAX,
  ITEM_DESCRIPTION_MAX,
  ITEM_NAME_MAX,
  ITEM_NAME_MIN,
  LOCATION_NAME_MAX,
  LOCATION_NAME_MIN,
  MAX_PATH_ID,
  PRICE_MAX,
  SORT_ORDER_MAX,
  STOCK_BULK_MAX,
  STOCK_MAX,
} from '../limits.js';
import { normalizeIndianMobile } from '../phone.js';
import { hhmmSchema } from './delivery.js';

export const dashboardQuerySchema = z.strictObject({
  date: z.iso.date().optional(),
});
export type DashboardQueryInput = z.input<typeof dashboardQuerySchema>;
export type DashboardQueryOutput = z.output<typeof dashboardQuerySchema>;

export const ordersQuerySchema = z.strictObject({
  date: z.iso.date().optional(),
  mode: z.enum(DELIVERY_MODES).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  slotId: z.coerce.number().int().min(1).max(MAX_PATH_ID).optional(),
  q: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(ADMIN_SEARCH_MAX))
    .transform((s) => s || undefined)
    .optional(),
  limit: z.coerce.number().int().min(1).max(ADMIN_ORDERS_LIMIT).optional(),
});
export type OrdersQueryInput = z.input<typeof ordersQuerySchema>;
export type OrdersQueryOutput = z.output<typeof ordersQuerySchema>;

export const orderActionSchema = z.union([
  z.strictObject({
    status: z.enum(ORDER_STATUSES),
  }),
  z.strictObject({
    paymentStatus: z.enum(PAYMENT_STATUSES),
  }),
]);
export type OrderActionInput = z.input<typeof orderActionSchema>;
export type OrderActionOutput = z.output<typeof orderActionSchema>;
export type OrderAction = OrderActionOutput;

export const completeManySchema = z.strictObject({
  orderIds: z
    .array(z.number().int().min(1).max(MAX_PATH_ID))
    .min(1, 'Select at least one order')
    .max(COMPLETE_MANY_MAX, `Cannot complete more than ${COMPLETE_MANY_MAX} orders at once`)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate order IDs are not allowed'),
  markCollected: z.boolean(),
});
export type CompleteManyInput = z.input<typeof completeManySchema>;
export type CompleteManyOutput = z.output<typeof completeManySchema>;

export const menuItemCreateSchema = z.strictObject({
  name: z
    .string()
    .transform((s) => s.trim().replace(/\s+/g, ' '))
    .pipe(
      z
        .string()
        .min(ITEM_NAME_MIN, `Name must be at least ${ITEM_NAME_MIN} characters`)
        .max(ITEM_NAME_MAX, `Name cannot exceed ${ITEM_NAME_MAX} characters`),
    ),
  description: z
    .string()
    .nullish()
    .transform((s) => (s ?? '').trim() || null)
    .pipe(z.string().max(ITEM_DESCRIPTION_MAX).nullable())
    .optional(),
  price: z.number().int().min(1, 'Price must be positive').max(PRICE_MAX),
  imageUrl: z
    .string()
    .nullish()
    .transform((s) => (s ?? '').trim() || null)
    .pipe(
      z
        .string()
        .url('Enter a valid image URL')
        .max(IMAGE_URL_MAX)
        .regex(/^https:\/\//, 'Image URL must use https')
        .nullable(),
    )
    .optional(),
  isAvailable: z.boolean().default(true),
});
export type MenuItemCreateInput = z.input<typeof menuItemCreateSchema>;
export type MenuItemCreateOutput = z.output<typeof menuItemCreateSchema>;

export const menuItemUpdateSchema = z
  .strictObject({
    name: z
      .string()
      .transform((s) => s.trim().replace(/\s+/g, ' '))
      .pipe(
        z
          .string()
          .min(ITEM_NAME_MIN, `Name must be at least ${ITEM_NAME_MIN} characters`)
          .max(ITEM_NAME_MAX, `Name cannot exceed ${ITEM_NAME_MAX} characters`),
      )
      .optional(),
    description: z
      .string()
      .nullish()
      .transform((s) => (s ?? '').trim() || null)
      .pipe(z.string().max(ITEM_DESCRIPTION_MAX).nullable())
      .optional(),
    price: z.number().int().min(1, 'Price must be positive').max(PRICE_MAX).optional(),
    imageUrl: z
      .string()
      .nullish()
      .transform((s) => (s ?? '').trim() || null)
      .pipe(
        z
          .string()
          .url('Enter a valid image URL')
          .max(IMAGE_URL_MAX)
          .regex(/^https:\/\//, 'Image URL must use https')
          .nullable(),
      )
      .optional(),
    isAvailable: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(SORT_ORDER_MAX).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');
export type MenuItemUpdateInput = z.input<typeof menuItemUpdateSchema>;
export type MenuItemUpdateOutput = z.output<typeof menuItemUpdateSchema>;

export const stockBulkSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        menuItemId: z.number().int().positive(),
        stock: z.number().int().min(0).max(STOCK_MAX),
      }),
    )
    .min(1, 'At least one item required')
    .max(STOCK_BULK_MAX, `Cannot set more than ${STOCK_BULK_MAX} items at once`)
    .refine(
      (items) => new Set(items.map((i) => i.menuItemId)).size === items.length,
      'Duplicate menu items',
    ),
});
export type StockBulkInput = z.input<typeof stockBulkSchema>;
export type StockBulkOutput = z.output<typeof stockBulkSchema>;

export const locationCreateSchema = z.strictObject({
  name: z
    .string()
    .transform((s) => s.trim().replace(/\s+/g, ' '))
    .pipe(
      z
        .string()
        .min(LOCATION_NAME_MIN, `Name must be at least ${LOCATION_NAME_MIN} characters`)
        .max(LOCATION_NAME_MAX, `Name cannot exceed ${LOCATION_NAME_MAX} characters`),
    ),
  sortOrder: z.number().int().min(0).max(SORT_ORDER_MAX).optional(),
});
export type LocationCreateInput = z.input<typeof locationCreateSchema>;
export type LocationCreateOutput = z.output<typeof locationCreateSchema>;

export const locationUpdateSchema = z
  .strictObject({
    name: z
      .string()
      .transform((s) => s.trim().replace(/\s+/g, ' '))
      .pipe(
        z
          .string()
          .min(LOCATION_NAME_MIN, `Name must be at least ${LOCATION_NAME_MIN} characters`)
          .max(LOCATION_NAME_MAX, `Name cannot exceed ${LOCATION_NAME_MAX} characters`),
      )
      .optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(SORT_ORDER_MAX).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');
export type LocationUpdateInput = z.input<typeof locationUpdateSchema>;
export type LocationUpdateOutput = z.output<typeof locationUpdateSchema>;

export const slotCreateSchema = z
  .strictObject({
    locationId: z.number().int().positive(),
    deliveryTime: hhmmSchema,
    cutoffTime: hhmmSchema,
    isActive: z.boolean().optional(),
  })
  .refine((data) => data.cutoffTime < data.deliveryTime, {
    message: 'Cutoff must be before the delivery time.',
    path: ['cutoffTime'],
  });
export type SlotCreateInput = z.input<typeof slotCreateSchema>;
export type SlotCreateOutput = z.output<typeof slotCreateSchema>;

export const slotUpdateSchema = z
  .strictObject({
    deliveryTime: hhmmSchema.optional(),
    cutoffTime: hhmmSchema.optional(),
    isActive: z.boolean().optional(),
    closedToday: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided')
  .refine(
    (data) => !data.cutoffTime || !data.deliveryTime || data.cutoffTime < data.deliveryTime,
    {
      message: 'Cutoff must be before the delivery time.',
      path: ['cutoffTime'],
    },
  );
export type SlotUpdateInput = z.input<typeof slotUpdateSchema>;
export type SlotUpdateOutput = z.output<typeof slotUpdateSchema>;

export const settingsUpdateSchema = z
  .strictObject({
    ordersPaused: z.boolean().optional(),
    expressEnabled: z.boolean().optional(),
    expressFee: z.number().int().min(0).max(FEE_MAX).optional(),
    batchFee: z.number().int().min(0).max(FEE_MAX).optional(),
    expressEtaMinMinutes: z.number().int().min(ETA_MINUTES_MIN).max(ETA_MINUTES_MAX).optional(),
    expressEtaMaxMinutes: z.number().int().min(ETA_MINUTES_MIN).max(ETA_MINUTES_MAX).optional(),
    expressOpensAt: hhmmSchema.optional(),
    expressClosesAt: hhmmSchema.optional(),
    contactPhone: z
      .string()
      .nullish()
      .transform((s, ctx) => {
        if (!s || !s.trim()) return null;
        const n = normalizeIndianMobile(s);
        if (!n) {
          ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit mobile number' });
          return z.NEVER;
        }
        return n;
      })
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');
export type SettingsUpdateInput = z.input<typeof settingsUpdateSchema>;
export type SettingsUpdateOutput = z.output<typeof settingsUpdateSchema>;
