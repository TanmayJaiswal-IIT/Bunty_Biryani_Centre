import { createElement as h } from 'react';
import { describe, expect, it } from 'vitest';
import { OrderDetails } from '../../src/client/features/customer/order/OrderDetails';
import { parseOrderRouterState } from '../../src/client/features/customer/order/order-state';
import { render } from '../helpers/markup';
import type { PublicOrderView } from '../../src/shared/api-types';

const baseOrder: PublicOrderView = {
  orderNumber: 'BB1001',
  status: 'ORDER_RECEIVED',
  paymentMethod: 'COD',
  paymentStatus: 'PENDING',
  deliveryMode: 'BATCH',
  deliveryDate: '2026-10-04',
  locationName: 'MSH',
  slotDeliveryTime: '20:00',
  expressWindow: null,
  customerName: 'Rahul Verma',
  addressDetail: 'Room 214',
  items: [
    { name: 'Chicken Biryani', unitPrice: 150, quantity: 2, lineTotal: 300 },
  ],
  foodSubtotal: 300,
  deliveryFee: 0,
  total: 300,
  createdAt: '2026-10-04T13:40:00.000Z',
  contactPhone: '9876543210',
};

describe('Order page router state guard (OS1-OS3)', () => {
  it('OS1: accepts matching orderNumber and valid phone', () => {
    const res = parseOrderRouterState(
      { order: baseOrder, phone: '9876543210', placed: true },
      'BB1001',
    );
    expect(res).not.toBeNull();
    expect(res?.order.orderNumber).toBe('BB1001');
    expect(res?.phone).toBe('9876543210');
    expect(res?.placed).toBe(true);
  });

  it('OS2: rejects mismatched order number', () => {
    const res = parseOrderRouterState(
      { order: baseOrder, phone: '9876543210' },
      'BB9999',
    );
    expect(res).toBeNull();
  });

  it('OS3: rejects malformed state', () => {
    expect(parseOrderRouterState(null, 'BB1001')).toBeNull();
    expect(parseOrderRouterState({}, 'BB1001')).toBeNull();
    expect(parseOrderRouterState({ order: { invalid: true }, phone: '123' }, 'BB1001')).toBeNull();
    expect(parseOrderRouterState({ order: baseOrder, phone: '' }, 'BB1001')).toBeNull();
  });
});

describe('Order details markup', () => {
  it('renders just-placed order with ORDER PLACED heading and copy button', () => {
    const html = render(
      h(OrderDetails, { order: baseOrder, placed: true, businessDate: '2026-10-04' }),
    );
    expect(html).toContain('ORDER PLACED');
    expect(html).toContain('BB1001');
    expect(html).toContain('Copy');
    expect(html).toContain('Batch · MSH');
    expect(html).toContain('Today, 8:00 PM');
    expect(html).toContain('Room 214');
    expect(html).toContain('Chicken Biryani × 2');
    expect(html).toContain('₹300');
    expect(html).toContain('Payment: CASH ON DELIVERY');
    expect(html).toContain('Pay ₹300 in cash when your food arrives.');
    expect(html).toContain('Need help? Call 9876543210');
    expect(html).not.toContain('Paid');
  });

  it('renders later visit with ORDER BB1001 and Order received chip', () => {
    const html = render(
      h(OrderDetails, { order: baseOrder, placed: false, businessDate: '2026-10-04' }),
    );
    expect(html).toContain('ORDER BB1001');
    expect(html).toContain('Order received');
    expect(html).not.toContain('ORDER PLACED');
  });

  it('renders completed status and collected payment label', () => {
    const completedOrder: PublicOrderView = {
      ...baseOrder,
      status: 'COMPLETED',
      paymentStatus: 'COLLECTED',
    };
    const html = render(
      h(OrderDetails, { order: completedOrder, placed: false, businessDate: '2026-10-04' }),
    );
    expect(html).toContain('Completed');
    expect(html).toContain('Cash on delivery · Collected');
    expect(html).not.toContain('Payment: CASH ON DELIVERY');
  });

  it('renders cancelled status with danger banner', () => {
    const cancelledOrder: PublicOrderView = {
      ...baseOrder,
      status: 'CANCELLED',
    };
    const html = render(
      h(OrderDetails, { order: cancelledOrder, placed: false, businessDate: '2026-10-04' }),
    );
    expect(html).toContain('Cancelled');
    expect(html).toContain('This order was cancelled. Contact Bunty Biryani Centre if you have questions.');
    expect(html).toContain('Call 9876543210');
  });

  it('renders express order window correctly', () => {
    const expressOrder: PublicOrderView = {
      ...baseOrder,
      deliveryMode: 'EXPRESS',
      locationName: 'Kanhar',
      slotDeliveryTime: null,
      expressWindow: {
        from: '19:40',
        to: '19:50',
        etaText: '30–40 minutes',
      },
      deliveryFee: 30,
      total: 330,
    };
    const html = render(
      h(OrderDetails, { order: expressOrder, placed: true, businessDate: '2026-10-04' }),
    );
    expect(html).toContain('Express · Kanhar');
    expect(html).toContain('Approx. 30–40 minutes (around 7:40–7:50 PM)');
    expect(html).toContain('₹330');
  });
});
