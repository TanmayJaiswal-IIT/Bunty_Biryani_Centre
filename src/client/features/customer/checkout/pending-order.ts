import type { CreateOrderOutput } from '@shared/schemas/order.js';
import { z } from 'zod';
import { readStorage, removeStorage, writeStorage } from '../../../lib/storage';
import { newUuid } from '../../../lib/uuid';

// The id that makes "Try again" safe (Batch 5 §7.1). The same order content keeps the same
// `clientRequestId`, so a retry after a dropped connection is a replay, never a second order.

export const PENDING_ORDER_KEY = 'bbc.pendingOrder.v1'; // sessionStorage

/** Stands in for the request id while the fingerprint is computed (the id is not part of it). */
export const FINGERPRINT_ID = '00000000-0000-4000-8000-000000000000';

const pendingSchema = z.strictObject({
  clientRequestId: z.string().min(1),
  fingerprint: z.string(),
});
type Pending = z.output<typeof pendingSchema>;

// Mirror of what was written, for when sessionStorage is blocked: a retry must still reuse the id.
let memory: Pending | null = null;

/** The request without its id: mode, location, slot, details, items and the expected total. */
export function orderFingerprint(request: CreateOrderOutput): string {
  return JSON.stringify([
    request.deliveryMode,
    request.locationId,
    request.deliveryMode === 'BATCH' ? request.slotId : null,
    request.customerName,
    request.customerPhone,
    request.addressDetail,
    request.items.map((item) => [item.menuItemId, item.quantity]),
    request.expectedTotal,
  ]);
}

function readStored(): Pending | null {
  const raw = readStorage(PENDING_ORDER_KEY, 'session');
  if (raw === null) return null;
  try {
    const parsed = pendingSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The stored id when the fingerprint matches (storage first, then memory); otherwise a new id, saved in both. */
export function requestIdFor(fingerprint: string, makeId: () => string = newUuid): string {
  // Either copy may be stale (a write that failed leaves the other one newer), so either may match.
  const known = [readStored(), memory].find((pending) => pending?.fingerprint === fingerprint);
  if (known) return known.clientRequestId;
  const next: Pending = { clientRequestId: makeId(), fingerprint };
  memory = next;
  writeStorage(PENDING_ORDER_KEY, JSON.stringify(next), 'session');
  return next.clientRequestId;
}

export function clearPendingOrder(): void {
  memory = null;
  removeStorage(PENDING_ORDER_KEY, 'session');
}
