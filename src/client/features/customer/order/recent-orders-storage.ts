import { z } from 'zod';
import { readStorage, writeStorage } from '../../../lib/storage';

export const RECENT_ORDERS_KEY = 'bbc.orders.v1';
export const MAX_RECENT_ORDERS = 10;

export const recentOrderSchema = z.object({
  orderNumber: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  deliveryDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type RecentOrder = z.infer<typeof recentOrderSchema>;

const recentOrdersListSchema = z.array(recentOrderSchema);

export function readRecentOrders(): RecentOrder[] {
  const raw = readStorage(RECENT_ORDERS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = recentOrdersListSchema.safeParse(parsed);
    if (!result.success) return [];
    return result.data.slice(0, MAX_RECENT_ORDERS);
  } catch {
    return [];
  }
}

export function saveRecentOrder(order: RecentOrder): void {
  const current = readRecentOrders();
  const filtered = current.filter(
    (o) => o.orderNumber.toUpperCase() !== order.orderNumber.toUpperCase(),
  );
  const updated = [order, ...filtered].slice(0, MAX_RECENT_ORDERS);
  writeStorage(RECENT_ORDERS_KEY, JSON.stringify(updated));
}

export function getRecentOrderPhone(orderNumber: string): string | null {
  const upper = orderNumber.trim().toUpperCase();
  const all = readRecentOrders();
  const match = all.find((o) => o.orderNumber.toUpperCase() === upper);
  return match ? match.phone : null;
}
