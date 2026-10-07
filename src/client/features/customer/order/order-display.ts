import type { PublicOrderView } from '@shared/api-types.js';
import { formatBusinessDate, formatTime12h, formatWindow } from '@shared/time.js';
import { copy } from '../../../copy';

const o = copy.customer.order;

/**
 * When the food arrives. A batch order is "Today, 8:00 PM" on the business date and dated on any
 * other day, or while the business date isn't known yet. An express order never gets an exact
 * time: an approximate window, date-prefixed under the same rule.
 */
export function deliveryWhen(order: PublicOrderView, businessDate: string | null): string {
  const isToday = order.deliveryDate === businessDate;
  const date = formatBusinessDate(order.deliveryDate);
  if (order.deliveryMode === 'EXPRESS' && order.expressWindow) {
    const { from, to, etaText } = order.expressWindow;
    const text = o.expressWhen(etaText, formatWindow(from, to));
    return isToday ? text : o.onDate(date, text);
  }
  const time = order.slotDeliveryTime ? formatTime12h(order.slotDeliveryTime) : '';
  return isToday ? o.today(time) : o.onDate(date, time);
}
