import { z } from 'zod';
import {
  DELIVERY_MODES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '../enums.js';
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

/** Form state uses the input types; the parsed output is what gets sent and what the server works with. */
export type CreateOrderInput = z.input<typeof createOrderSchema>;
export type CreateOrderOutput = z.output<typeof createOrderSchema>;
export type CustomerDetailsInput = z.input<typeof customerDetailsSchema>;

export const orderNumberSchema = z
  .string()
  .transform((s) => {
    let v = s.trim().toUpperCase();
    if (/^\d+$/.test(v)) v = `BB${v}`;
    return v;
  })
  .pipe(z.string().regex(/^BB\d{4,9}$/, 'Enter an order ID like BB1023'));

export const lookupSchema = z.strictObject({
  orderNumber: orderNumberSchema,
  phone: customerPhoneSchema,
});

export type LookupOrderInput = z.input<typeof lookupSchema>;
export type LookupOrderOutput = z.output<typeof lookupSchema>;

export const publicOrderItemSchema = z.strictObject({
  name: z.string(),
  unitPrice: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  lineTotal: z.number().int().nonnegative(),
});

export const expressWindowSchema = z.strictObject({
  from: hhmmSchema,
  to: hhmmSchema,
  etaText: z.string(),
});

export const publicOrderViewSchema = z.strictObject({
  orderNumber: z.string().regex(/^BB\d{4,9}$/),
  status: z.enum(ORDER_STATUSES),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  deliveryMode: z.enum(DELIVERY_MODES),
  deliveryDate: z.iso.date(),
  locationName: z.string(),
  slotDeliveryTime: hhmmSchema.nullable(),
  expressWindow: expressWindowSchema.nullable(),
  customerName: z.string(),
  addressDetail: z.string().nullable(),
  items: z.array(publicOrderItemSchema),
  foodSubtotal: z.number().int().nonnegative(),
  deliveryFee: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  contactPhone: z
    .string()
    .regex(/^[6-9]\d{9}$/)
    .nullable(),
});

export const createOrderResponseSchema = publicOrderViewSchema.extend({
  replayed: z.boolean(),
});

