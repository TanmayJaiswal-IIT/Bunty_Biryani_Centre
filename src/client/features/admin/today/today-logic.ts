import type { Dashboard, DashboardBatch } from '@shared/api-types.js';
import { formatINR } from '@shared/money.js';
import { formatTime12h } from '@shared/time.js';

export function shiftDate(date: string, days: number): string {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function dateHref(date: string, d: Dashboard): string {
  if (d.isToday && date === d.date) {
    return '/admin';
  }
  return `/admin?date=${encodeURIComponent(date)}`;
}

export function expressSubtext(
  c: Dashboard['controls'],
  _serverTime: string,
): string {
  void _serverTime;
  if (!c.expressEnabled) {
    return 'Off';
  }
  if (c.expressAvailableNow) {
    return `On · till ${formatTime12h(c.expressClosesAt)}`;
  }
  return `On · opens ${formatTime12h(c.expressOpensAt)}`;
}

export function slotChip(
  b: DashboardBatch,
  isToday: boolean,
): {
  tone: 'neutral' | 'gold' | 'success' | 'warning' | 'danger' | 'info';
  text: string;
} | null {
  if (!isToday) {
    return null;
  }
  if (b.closedToday) {
    return { tone: 'warning', text: 'Closed today' };
  }
  if (b.isOpenNow) {
    return { tone: 'success', text: `Open till ${formatTime12h(b.cutoffTime)}` };
  }
  return { tone: 'neutral', text: 'Closed for orders' };
}

export function countLine(b: DashboardBatch): string {
  const orderText = b.orderCount === 1 ? '1 order' : `${b.orderCount} orders`;
  const itemText = b.itemCount === 1 ? '1 item' : `${b.itemCount} items`;
  return `${orderText} · ${itemText} · ${formatINR(b.codTotal)} COD`;
}

export function breakdownLine(b: DashboardBatch): string {
  return b.itemBreakdown.map((i) => `${i.name} ×${i.quantity}`).join(' · ');
}

export function openIds(b: DashboardBatch): number[] {
  return b.orders
    .filter((o) => o.status === 'ORDER_RECEIVED')
    .map((o) => o.id);
}
