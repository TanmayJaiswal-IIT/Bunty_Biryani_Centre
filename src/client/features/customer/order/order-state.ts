import type { PublicOrderView } from '@shared/api-types.js';
import { normalizeIndianMobile } from '@shared/phone.js';
import { publicOrderViewSchema } from '@shared/schemas/order.js';

/** Router state for `/order/:orderNumber`: set by the checkout submit and by the track form. */
export interface OrderRouteState {
  order: PublicOrderView;
  phone: string;
  placed: boolean;
}

/**
 * The router state, or `null` when it can't be trusted: history entries survive reloads and
 * deploys, so a stale, foreign or malformed object falls back to a lookup (Batch 5 §8.1). The
 * create response's `replayed` flag is dropped first because the public view is strict.
 */
export function parseOrderState(state: unknown, orderNumber: string): OrderRouteState | null {
  if (typeof state !== 'object' || state === null) return null;
  const { order, phone, placed } = state as Record<string, unknown>;
  if (typeof phone !== 'string' || typeof placed !== 'boolean') return null;
  if (typeof order !== 'object' || order === null) return null;
  const tenDigits = normalizeIndianMobile(phone);
  if (!tenDigits) return null;
  const view = publicOrderViewSchema.safeParse(
    Object.fromEntries(Object.entries(order).filter(([key]) => key !== 'replayed')),
  );
  if (!view.success || view.data.orderNumber !== orderNumber) return null;
  return { order: view.data, phone: tenDigits, placed };
}
