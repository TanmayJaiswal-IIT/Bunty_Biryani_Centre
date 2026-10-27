import { z } from 'zod';
import { EXPRESS_UNAVAILABLE_REASONS } from '../enums.js';
import { isValidHHmm } from '../time.js';

const id = z.number().int().positive();
export const hhmmSchema = z.string().refine(isValidHHmm, 'Expected HH:mm');
const fee = z.number().int().min(0);

/**
 * `GET /api/delivery-options` (Batch 1 §8.4). Strict throughout so an internal column such as
 * `closedOn` or `isActive` fails the parse instead of reaching customers.
 */
export const deliverySlotOptionSchema = z.strictObject({
  id,
  locationId: id,
  locationName: z.string(),
  deliveryTime: hhmmSchema,
  cutoffTime: hhmmSchema,
  isOpen: z.boolean(),
  /** INACTIVE slots are omitted from the response, so it never appears here. */
  closedReason: z.enum(['CUTOFF_PASSED', 'CLOSED_TODAY']).nullable(),
});

export const expressOptionsSchema = z.strictObject({
  available: z.boolean(),
  unavailableReason: z.enum(EXPRESS_UNAVAILABLE_REASONS).nullable(),
  fee,
  etaMinMinutes: z.number().int().min(0),
  etaMaxMinutes: z.number().int().min(0),
  etaText: z.string(),
  opensAt: hhmmSchema,
  closesAt: hhmmSchema,
  locations: z.array(z.strictObject({ id, name: z.string() })),
});

export const deliveryOptionsSchema = z.strictObject({
  /** IST business date, `YYYY-MM-DD`. */
  businessDate: z.iso.date(),
  /** Server time of day in IST, `HH:mm`. The client never reads its own clock. */
  serverTime: hhmmSchema,
  ordersPaused: z.boolean(),
  /** Help number shown to customers, 10 digits, or null when not configured. */
  contactPhone: z
    .string()
    .regex(/^[6-9]\d{9}$/)
    .nullable(),
  batch: z.strictObject({ fee, slots: z.array(deliverySlotOptionSchema) }),
  express: expressOptionsSchema,
});
