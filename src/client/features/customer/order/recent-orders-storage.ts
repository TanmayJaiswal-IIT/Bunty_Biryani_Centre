import { orderNumberSchema, customerPhoneSchema } from '@shared/schemas/order.js';
import { z } from 'zod';
import { readStorage, writeStorage } from '../../../lib/storage';

// Orders placed on this phone, kept so the track page can offer them and the order page can look an
// order up without asking for the number again (Batch 5 §10). Nothing here the customer didn't type.

export const RECENT_ORDERS_KEY = 'bbc.orders.v1'; // localStorage
export const MAX_RECENT_ORDERS = 10;

const recentOrderSchema = z.strictObject({
  orderNumber: orderNumberSchema,
  phone: customerPhoneSchema,
  deliveryDate: z.iso.date(),
});

export type RecentOrder = z.output<typeof recentOrderSchema>;

/** Never throws: anything unreadable is an empty list, and an invalid entry is dropped on its own. */
export function parseRecentOrders(raw: string | null): RecentOrder[] {
  if (raw === null) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(json)) return [];
  const entries: RecentOrder[] = [];
  for (const candidate of json as unknown[]) {
    const parsed = recentOrderSchema.safeParse(candidate);
    if (parsed.success) entries.push(parsed.data);
  }
  return entries.slice(0, MAX_RECENT_ORDERS);
}

/** Newest first; an existing entry for the same order number moves to the front; at most 10. */
export function withRecentOrder(list: readonly RecentOrder[], entry: RecentOrder): RecentOrder[] {
  return [entry, ...list.filter((o) => o.orderNumber !== entry.orderNumber)].slice(
    0,
    MAX_RECENT_ORDERS,
  );
}

export function readRecentOrders(): RecentOrder[] {
  return parseRecentOrders(readStorage(RECENT_ORDERS_KEY));
}

export function addRecentOrder(entry: RecentOrder): void {
  writeStorage(RECENT_ORDERS_KEY, JSON.stringify(withRecentOrder(readRecentOrders(), entry)));
}

/** The phone saved for this order on this device, or `null`. */
export function phoneForOrder(orderNumber: string): string | null {
  return readRecentOrders().find((o) => o.orderNumber === orderNumber)?.phone ?? null;
}
