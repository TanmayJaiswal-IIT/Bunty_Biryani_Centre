import { DELIVERY_MODES } from '@shared/enums.js';
import {
  addressDetailSchema,
  customerNameSchema,
  customerPhoneSchema,
} from '@shared/schemas/order.js';
import { z } from 'zod';
import type { DetailsForm } from './build-order-request';
import type { Selection } from './selection';

export const CHECKOUT_DRAFT_KEY = 'bbc.checkout.v1'; // sessionStorage
export const REMEMBERED_CUSTOMER_KEY = 'bbc.customer.v1'; // localStorage; written by Batch 5

export interface CheckoutDraft {
  selection: Selection;
  details: DetailsForm;
}

// The draft is half-typed text, so it is not validated as a name or phone; it is only bounded.
// 200 is generous for any field (the address limit is 120) and stops a hand-edited blob.
const DRAFT_TEXT_MAX = 200;
const id = z.number().int().positive().nullable();

const draftSchema = z.strictObject({
  deliveryMode: z.enum(DELIVERY_MODES).nullable(),
  slotId: id,
  locationId: id,
  customerName: z.string().max(DRAFT_TEXT_MAX),
  customerPhone: z.string().max(DRAFT_TEXT_MAX),
  addressDetail: z.string().max(DRAFT_TEXT_MAX),
});

/** What the last order's customer typed, for prefilling (Batch 4 §7). */
export const rememberedCustomerSchema = z.strictObject({
  customerName: customerNameSchema,
  customerPhone: customerPhoneSchema,
  addressDetail: addressDetailSchema,
  deliveryMode: z.enum(DELIVERY_MODES),
  locationId: z.number().int().positive(),
});

export type RememberedCustomer = z.output<typeof rememberedCustomerSchema>;

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Reads the sessionStorage draft. Never throws: anything unreadable or invalid is no draft. */
export function parseDraft(raw: string | null): CheckoutDraft | null {
  const parsed = draftSchema.safeParse(parseJson(raw));
  if (!parsed.success) return null;
  const { deliveryMode, slotId, locationId, customerName, customerPhone, addressDetail } =
    parsed.data;
  return {
    selection: { deliveryMode, slotId, locationId },
    details: { customerName, customerPhone, addressDetail },
  };
}

export function serializeDraft(draft: CheckoutDraft): string {
  return JSON.stringify({ ...draft.selection, ...draft.details });
}

/** Reads the localStorage record. Never throws: anything unreadable or invalid is ignored. */
export function parseRemembered(raw: string | null): RememberedCustomer | null {
  const parsed = rememberedCustomerSchema.safeParse(parseJson(raw));
  return parsed.success ? parsed.data : null;
}

export function serializeRemembered(remembered: RememberedCustomer): string {
  return JSON.stringify(remembered);
}
