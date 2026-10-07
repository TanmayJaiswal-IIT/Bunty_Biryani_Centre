import { z } from 'zod';
import { DELIVERY_MODES, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '../enums.js';
import {
  ADDRESS_MAX,
  MAX_LINES_PER_ORDER,
  MAX_QTY_PER_ITEM,
  NAME_MAX,
  NAME_MIN,
} from '../limits.js';
import { normalizeIndianMobile } from '../phone.js';
import { hhmmSchema } from './delivery.js';

// Messages are customer-facing copy (Batch 4 §4).

const id = z.number().int().positive();

export const customerNameSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(NAME_MIN, 'Enter your name').max(NAME_MAX, 'Name is too long'));

export const customerPhoneSchema = z.string().transform((s, ctx) => {
  const n = normalizeIndianMobile(s);
  if (!n) {
    ctx.addIssue({ code: 'custom', message: 'Enter a 10-digit mobile number' });
    return z.NEVER;
  }
  return n;
});

export const addressDetailSchema = z
  .string()
  .nullish()
  .transform((s) => (s ?? '').trim() || null)
  .pipe(z.string().max(ADDRESS_MAX, 'Keep it under 120 characters').nullable());

export const orderLineSchema = z.object({
  menuItemId: id,
  quantity: z.number().int().min(1).max(MAX_QTY_PER_ITEM),
});

const base = {
  clientRequestId: z.uuid(),
  customerName: customerNameSchema,
  customerPhone: customerPhoneSchema,
  addressDetail: addressDetailSchema,
  items: z.array(orderLineSchema).min(1).max(MAX_LINES_PER_ORDER),
  expectedTotal: z.number().int().nonnegative(),
};

export const createOrderSchema = z.discriminatedUnion('deliveryMode', [
  z.strictObject({ ...base, deliveryMode: z.literal('BATCH'), locationId: id, slotId: id }),
  z.strictObject({ ...base, deliveryMode: z.literal('EXPRESS'), locationId: id }),
]);

export const customerDetailsSchema = z.object({
  customerName: customerNameSchema,
  customerPhone: customerPhoneSchema,
  addressDetail: addressDetailSchema,
});

export const ORDER_NUMBER_PATTERN = /^BB\d{4,9}$/;

/** trim, upper-case, a digits-only value gets the "BB" prefix, then it must look like an order ID. */
export const orderNumberSchema = z
  .string()
  .transform((s) => {
    const t = s.trim().toUpperCase();
    return /^\d+$/.test(t) ? `BB${t}` : t;
  })
  .pipe(z.string().regex(ORDER_NUMBER_PATTERN, 'Enter your order ID, like BB1023'));

/** `POST /api/orders/lookup` (Batch 1 §8.4). */
export const lookupSchema = z.strictObject({
  orderNumber: orderNumberSchema,
  phone: customerPhoneSchema,
});

const money = z.number().int().min(0);

/**
 * The public order view (Batch 1 §8.4): what `POST /api/orders` and the lookup return. Strict, so an
 * internal id or the customer's phone fails the parse instead of reaching the browser.
 */
export const publicOrderViewSchema = z.strictObject({
  orderNumber: orderNumberSchema,
  status: z.enum(ORDER_STATUSES),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  deliveryMode: z.enum(DELIVERY_MODES),
  deliveryDate: z.iso.date(),
  locationName: z.string(),
  slotDeliveryTime: hhmmSchema.nullable(),
  expressWindow: z
    .strictObject({ from: hhmmSchema, to: hhmmSchema, etaText: z.string() })
    .nullable(),
  customerName: z.string(),
  addressDetail: z.string().nullable(),
  items: z
    .array(
      z.strictObject({
        name: z.string(),
        unitPrice: money,
        quantity: z.number().int().min(1),
        lineTotal: money,
      }),
    )
    .min(1),
  foodSubtotal: money,
  deliveryFee: money,
  total: money,
  createdAt: z.iso.datetime(),
  /** Help number shown to customers, 10 digits, or null when not configured. */
  contactPhone: z
    .string()
    .regex(/^[6-9]\d{9}$/)
    .nullable(),
});

/** `201` for a new order, `200` for an idempotent replay. */
export const createOrderResponseSchema = publicOrderViewSchema.extend({ replayed: z.boolean() });

/** Form state uses the input types; the parsed output is what gets sent and what the server works with. */
export type CreateOrderInput = z.input<typeof createOrderSchema>;
export type CreateOrderOutput = z.output<typeof createOrderSchema>;
export type CustomerDetailsInput = z.input<typeof customerDetailsSchema>;
export type LookupInput = z.input<typeof lookupSchema>;
export type LookupOutput = z.output<typeof lookupSchema>;
