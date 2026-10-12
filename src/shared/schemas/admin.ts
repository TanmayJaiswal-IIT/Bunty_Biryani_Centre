import { z } from 'zod';
import { DELIVERY_MODES, ORDER_STATUSES, PAYMENT_STATUSES } from '../enums.js';
import {
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
import { isValidHHmm } from '../time.js';
import { hhmmSchema } from './delivery.js';

// Request schemas for the vendor dashboard and admin screens (Batch 6 §6). Every object is strict, so
// an unknown key (for example a stock field on a menu update) is a 400 instead of being ignored.
// The cross-field rules that need the stored row (ETA min <= max, opens < closes, a slot update's
// cutoff < delivery) run in the services on the merged result.

/** A client-supplied row id: a positive Postgres `int` (Batch 1 §8.1). */
const rowId = z.number().int().min(1).max(MAX_PATH_ID);

const collapseSpaces = (s: string): string => s.trim().replace(/\s+/g, ' ');

/** Trims and collapses inner whitespace, then checks the length. */
function nameField(min: number, max: number) {
  return z
    .string()
    .transform(collapseSpaces)
    .pipe(
      z
        .string()
        .min(min, `Enter at least ${min} characters.`)
        .max(max, `Use ${max} characters or fewer.`),
    );
}

const blankToNull = (s: string | null): string | null => {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
};

/** At least one key with a value, for PATCH bodies. */
const hasAnyValue = (o: Record<string, unknown>): boolean =>
  Object.values(o).some((v) => v !== undefined);
const NOTHING_TO_UPDATE = 'Nothing to update.';

// ---------- queries ----------

/** `GET /api/admin/dashboard`. "Not after today" is checked in the service, against the server clock. */
export const dashboardQuerySchema = z.strictObject({
  date: z.iso.date().optional(),
});

/** `GET /api/admin/orders`. An empty `q` means no search. */
export const ordersQuerySchema = z.strictObject({
  date: z.iso.date().optional(),
  mode: z.enum(DELIVERY_MODES).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  slotId: z.coerce.number().int().min(1).max(MAX_PATH_ID).optional(),
  q: z
    .string()
    .trim()
    .max(ADMIN_SEARCH_MAX, `Search is limited to ${ADMIN_SEARCH_MAX} characters.`)
    .transform((s) => (s === '' ? undefined : s))
    .optional(),
});

// ---------- orders ----------

/** `PATCH /api/admin/orders/:id/status`: exactly one of the two keys. */
export const orderActionSchema = z.union([
  z.strictObject({ status: z.enum(ORDER_STATUSES) }),
  z.strictObject({ paymentStatus: z.enum(PAYMENT_STATUSES) }),
]);

/** `POST /api/admin/orders/complete-many`. */
export const completeManySchema = z.strictObject({
  orderIds: z
    .array(rowId)
    .min(1)
    .max(COMPLETE_MANY_MAX)
    .refine((ids) => new Set(ids).size === ids.length, 'Order ids must be unique.'),
  markCollected: z.boolean(),
});

// ---------- menu and stock ----------

const itemName = nameField(ITEM_NAME_MIN, ITEM_NAME_MAX);

/** Empty or blank → `null`. */
const itemDescription = z
  .string()
  .nullable()
  .transform(blankToNull)
  .pipe(
    z
      .string()
      .max(ITEM_DESCRIPTION_MAX, `Use ${ITEM_DESCRIPTION_MAX} characters or fewer.`)
      .nullable(),
  );

/** Empty or blank → `null`; otherwise an `https://` URL. */
const itemImageUrl = z
  .string()
  .nullable()
  .transform(blankToNull)
  .pipe(
    z
      .url({ protocol: /^https$/, error: 'Use a link that starts with https://' })
      .max(IMAGE_URL_MAX, 'That link is too long.')
      .nullable(),
  );

const itemPrice = z
  .number()
  .int('Price must be a whole number of rupees.')
  .min(1, 'Price must be at least ₹1.')
  .max(PRICE_MAX, `Price can't be more than ₹${PRICE_MAX}.`);

const sortOrder = z.number().int().min(0).max(SORT_ORDER_MAX);

/**
 * `POST /api/admin/menu`. No stock fields and no `sortOrder` (a new item goes last). Absent
 * `description` / `imageUrl` stay absent; the service stores `null`.
 */
export const menuItemCreateSchema = z.strictObject({
  name: itemName,
  description: itemDescription.optional(),
  price: itemPrice,
  imageUrl: itemImageUrl.optional(),
  isAvailable: z.boolean().default(true),
});

/**
 * `PATCH /api/admin/menu/:id`. Written out instead of `menuItemCreateSchema.partial()`: a partial would
 * keep the `isAvailable` default and silently switch an item back on.
 */
export const menuItemUpdateSchema = z
  .strictObject({
    name: itemName.optional(),
    description: itemDescription.optional(),
    price: itemPrice.optional(),
    imageUrl: itemImageUrl.optional(),
    isAvailable: z.boolean().optional(),
    sortOrder: sortOrder.optional(),
  })
  .refine(hasAnyValue, NOTHING_TO_UPDATE);

/** `PUT /api/admin/stock`: today's stock for several items, all or nothing. */
export const stockBulkSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        menuItemId: rowId,
        stock: z.number().int().min(0).max(STOCK_MAX),
      }),
    )
    .min(1)
    .max(STOCK_BULK_MAX)
    .refine(
      (items) => new Set(items.map((i) => i.menuItemId)).size === items.length,
      'Each item can appear only once.',
    ),
});

// ---------- locations and slots ----------

const locationName = nameField(LOCATION_NAME_MIN, LOCATION_NAME_MAX);

export const locationCreateSchema = z.strictObject({
  name: locationName,
  sortOrder: sortOrder.optional(),
});

export const locationUpdateSchema = z
  .strictObject({
    name: locationName.optional(),
    isActive: z.boolean().optional(),
    sortOrder: sortOrder.optional(),
  })
  .refine(hasAnyValue, NOTHING_TO_UPDATE);

/**
 * `POST /api/admin/delivery-slots`. Times are zero-padded `HH:mm`, so a plain string comparison orders
 * them. The refine stays quiet when a time already failed its own check, to avoid a second, confusing issue.
 */
export const slotCreateSchema = z
  .strictObject({
    locationId: rowId,
    deliveryTime: hhmmSchema,
    cutoffTime: hhmmSchema,
    isActive: z.boolean().optional(),
  })
  .refine(
    (s) =>
      !isValidHHmm(s.deliveryTime) || !isValidHHmm(s.cutoffTime) || s.cutoffTime < s.deliveryTime,
    { path: ['cutoffTime'], error: 'Cutoff must be before the delivery time.' },
  );

/** `PATCH /api/admin/delivery-slots/:id`. The cutoff rule is checked on the merged row in the service. */
export const slotUpdateSchema = z
  .strictObject({
    deliveryTime: hhmmSchema.optional(),
    cutoffTime: hhmmSchema.optional(),
    isActive: z.boolean().optional(),
    closedToday: z.boolean().optional(),
  })
  .refine(hasAnyValue, NOTHING_TO_UPDATE);

// ---------- settings ----------

/** An Indian mobile, normalised to 10 digits; empty or `null` clears the help number. */
const contactPhone = z
  .string()
  .nullable()
  .transform((s, ctx) => {
    const t = (s ?? '').trim();
    if (t === '') return null;
    const n = normalizeIndianMobile(t);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Enter a 10-digit mobile number' });
      return z.NEVER;
    }
    return n;
  });

const fee = z.number().int().min(0).max(FEE_MAX);
const etaMinutes = z.number().int().min(ETA_MINUTES_MIN).max(ETA_MINUTES_MAX);

/** `PATCH /api/admin/settings`. ETA min <= max and opens < closes are checked on the merged row. */
export const settingsUpdateSchema = z
  .strictObject({
    ordersPaused: z.boolean().optional(),
    expressEnabled: z.boolean().optional(),
    expressFee: fee.optional(),
    batchFee: fee.optional(),
    expressEtaMinMinutes: etaMinutes.optional(),
    expressEtaMaxMinutes: etaMinutes.optional(),
    expressOpensAt: hhmmSchema.optional(),
    expressClosesAt: hhmmSchema.optional(),
    contactPhone: contactPhone.optional(),
  })
  .refine(hasAnyValue, NOTHING_TO_UPDATE);

// Forms use the input types; the parsed output is what the services work with.
export type DashboardQueryInput = z.input<typeof dashboardQuerySchema>;
export type DashboardQueryOutput = z.output<typeof dashboardQuerySchema>;
export type OrdersQueryInput = z.input<typeof ordersQuerySchema>;
export type OrdersQueryOutput = z.output<typeof ordersQuerySchema>;
export type OrderActionInput = z.input<typeof orderActionSchema>;
export type OrderActionOutput = z.output<typeof orderActionSchema>;
/** One status change: either the order status or the payment status, never both. */
export type OrderAction = OrderActionOutput;
export type CompleteManyInput = z.input<typeof completeManySchema>;
export type CompleteManyOutput = z.output<typeof completeManySchema>;
export type MenuItemCreateInput = z.input<typeof menuItemCreateSchema>;
export type MenuItemCreateOutput = z.output<typeof menuItemCreateSchema>;
export type MenuItemUpdateInput = z.input<typeof menuItemUpdateSchema>;
export type MenuItemUpdateOutput = z.output<typeof menuItemUpdateSchema>;
export type StockBulkInput = z.input<typeof stockBulkSchema>;
export type StockBulkOutput = z.output<typeof stockBulkSchema>;
export type LocationCreateInput = z.input<typeof locationCreateSchema>;
export type LocationCreateOutput = z.output<typeof locationCreateSchema>;
export type LocationUpdateInput = z.input<typeof locationUpdateSchema>;
export type LocationUpdateOutput = z.output<typeof locationUpdateSchema>;
export type SlotCreateInput = z.input<typeof slotCreateSchema>;
export type SlotCreateOutput = z.output<typeof slotCreateSchema>;
export type SlotUpdateInput = z.input<typeof slotUpdateSchema>;
export type SlotUpdateOutput = z.output<typeof slotUpdateSchema>;
export type SettingsUpdateInput = z.input<typeof settingsUpdateSchema>;
export type SettingsUpdateOutput = z.output<typeof settingsUpdateSchema>;
