import type { PublicOrderView } from '@shared/api-types.js';
import { createOrderResponseSchema, publicOrderViewSchema } from '@shared/schemas/order.js';

export interface OrderRouterState {
  order: PublicOrderView;
  phone: string;
  placed?: boolean;
}

export function parseOrderRouterState(
  state: unknown,
  targetOrderNumber: string,
): { order: PublicOrderView; phone: string; placed: boolean } | null {
  if (!state || typeof state !== 'object') return null;

  const candidate = state as { order?: unknown; phone?: unknown; placed?: unknown };
  if (typeof candidate.phone !== 'string' || !candidate.phone.trim()) return null;

  const parsedOrder = createOrderResponseSchema.or(publicOrderViewSchema).safeParse(candidate.order);
  if (!parsedOrder.success) return null;

  const order = parsedOrder.data;
  if (order.orderNumber.toUpperCase() !== targetOrderNumber.trim().toUpperCase()) {
    return null;
  }

  return {
    order,
    phone: candidate.phone.trim(),
    placed: Boolean(candidate.placed),
  };
}
