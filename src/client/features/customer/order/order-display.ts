import type { OrderStatus, PublicOrderView } from '@shared/api-types.js';
import { formatBusinessDate, formatTime12h, formatWindow } from '@shared/time.js';

export function formatDeliveryWhen(
  order: PublicOrderView,
  businessDate?: string | null,
): string {
  if (order.deliveryMode === 'BATCH') {
    const timeStr = order.slotDeliveryTime ? formatTime12h(order.slotDeliveryTime) : '';
    if (businessDate && order.deliveryDate === businessDate) {
      return `Today, ${timeStr}`;
    }
    return `${formatBusinessDate(order.deliveryDate)}, ${timeStr}`;
  }

  // EXPRESS
  if (order.expressWindow) {
    const windowStr = formatWindow(order.expressWindow.from, order.expressWindow.to);
    const main = `Approx. ${order.expressWindow.etaText} (around ${windowStr})`;
    if (businessDate && order.deliveryDate !== businessDate) {
      return `${formatBusinessDate(order.deliveryDate)}, ${main}`;
    }
    return main;
  }

  return formatBusinessDate(order.deliveryDate);
}

export function formatPaymentLabel(paymentStatus: PublicOrderView['paymentStatus']): string {
  if (paymentStatus === 'COLLECTED') {
    return 'Cash on delivery · Collected';
  }
  return 'Payment: CASH ON DELIVERY';
}

export interface StatusChipInfo {
  label: string;
  tone: 'info' | 'success' | 'danger';
}

export function getStatusChip(status: OrderStatus): StatusChipInfo {
  switch (status) {
    case 'COMPLETED':
      return { label: 'Completed', tone: 'success' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'danger' };
    case 'ORDER_RECEIVED':
    default:
      return { label: 'Order received', tone: 'info' };
  }
}
