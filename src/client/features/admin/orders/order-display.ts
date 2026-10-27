import type { AdminOrderView } from '@shared/api-types.js';
import {
  formatBusinessDate,
  formatTime12h,
  formatWindow,
  istParts,
} from '@shared/time.js';

export function itemsInline(o: AdminOrderView): string {
  return o.items.map((i) => `${i.name} ×${i.quantity}`).join(', ');
}

export function codLabel(o: AdminOrderView): string {
  return o.paymentStatus === 'COLLECTED' ? 'COD · Collected' : 'COD · Pending';
}

export function expressWhen(o: AdminOrderView): string {
  const parts = istParts(new Date(o.createdAt));
  const orderedTime = formatTime12h(parts.time);
  if (o.expressWindow) {
    const windowText = formatWindow(o.expressWindow.from, o.expressWindow.to);
    return `Ordered ${orderedTime} · deliver approx. ${windowText}`;
  }
  return `Ordered ${orderedTime}`;
}

export function formatInstant(iso: string): string {
  const parts = istParts(new Date(iso));
  return `${formatBusinessDate(parts.date)}, ${formatTime12h(parts.time)}`;
}

export function cancelDialogText(o: AdminOrderView, isToday: boolean): string {
  if (isToday) {
    return `Cancel order ${o.orderNumber}? The food will return to today's available stock.`;
  }
  return `Cancel order ${o.orderNumber}? This order is from an earlier day, so stock will not be affected.`;
}
