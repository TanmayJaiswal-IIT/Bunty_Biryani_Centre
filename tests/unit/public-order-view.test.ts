import { describe, expect, it } from 'vitest';
import { toDbDate } from '../../src/server/lib/db-date';
import {
  mergeLines,
  toPublicOrderView,
  type OrderForView,
} from '../../src/server/services/order.service';
import { publicOrderViewSchema } from '../../src/shared/schemas/order';
import { formatWindow } from '../../src/shared/time';
import { istInstant } from '../helpers/clock';

function batchOrder(over: Partial<OrderForView> = {}): OrderForView {
  return {
    orderNumber: 'BB1001',
    status: 'ORDER_RECEIVED',
    paymentMethod: 'COD',
    paymentStatus: 'PENDING',
    deliveryMode: 'BATCH',
    deliveryDate: toDbDate('2026-10-04'),
    locationName: 'MSH',
    slotDeliveryTime: '20:00',
    expressEtaMinMinutes: null,
    expressEtaMaxMinutes: null,
    customerName: 'Rahul Verma',
    addressDetail: 'Room 214, B block',
    foodSubtotal: 300,
    deliveryFee: 0,
    total: 300,
    createdAt: new Date(istInstant('19:10')),
    items: [{ id: 7, itemName: 'Chicken Biryani', unitPrice: 150, quantity: 2, lineTotal: 300 }],
    ...over,
  };
}

function expressOrder(createdAt: string, min: number, max: number): OrderForView {
  return batchOrder({
    deliveryMode: 'EXPRESS',
    locationName: 'Kanhar',
    slotDeliveryTime: null,
    expressEtaMinMinutes: min,
    expressEtaMaxMinutes: max,
    deliveryFee: 30,
    total: 330,
    createdAt: new Date(createdAt),
  });
}

describe('toPublicOrderView', () => {
  it('#38 builds the batch view: no express window, the slot time, IST date and ISO createdAt', () => {
    const view = toPublicOrderView(batchOrder(), '9123456780');
    expect(view).toEqual({
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
      addressDetail: 'Room 214, B block',
      items: [{ name: 'Chicken Biryani', unitPrice: 150, quantity: 2, lineTotal: 300 }],
      foodSubtotal: 300,
      deliveryFee: 0,
      total: 300,
      createdAt: '2026-10-04T13:40:00.000Z',
      contactPhone: '9123456780',
    });
  });

  it('#38 gives an express order created at 19:10 with 30-40 minutes the 19:40-19:50 window', () => {
    const view = toPublicOrderView(expressOrder(istInstant('19:10'), 30, 40), null);
    expect(view.expressWindow).toEqual({ from: '19:40', to: '19:50', etaText: '30–40 minutes' });
    expect(view.slotDeliveryTime).toBeNull();
    expect(view.contactPhone).toBeNull();
  });

  it('#38 builds a window that crosses noon (11:20 + 30-45 minutes)', () => {
    const view = toPublicOrderView(expressOrder(istInstant('11:20'), 30, 45), null);
    expect(view.expressWindow).toEqual({ from: '11:50', to: '12:05', etaText: '30–45 minutes' });
    expect(formatWindow(view.expressWindow!.from, view.expressWindow!.to)).toBe(
      '11:50 AM–12:05 PM',
    );
  });

  it('#38 passes the strict public schema and leaves out the internal id and the phone', () => {
    // A Prisma row carries more than OrderForView; none of the extra fields may reach the view.
    const row = {
      ...expressOrder(istInstant('19:10'), 30, 40),
      id: 42,
      clientRequestId: '6f1c2a7e-4b8d-4c1e-9a3f-2d5e8b7c9a10',
      customerPhone: '9876543210',
      locationId: 2,
      slotId: null,
      updatedAt: new Date(),
      completedAt: null,
      cancelledAt: null,
      collectedAt: null,
    };
    const view = toPublicOrderView(row, null);

    expect(() => publicOrderViewSchema.parse(view)).not.toThrow();
    expect(view).not.toHaveProperty('id');
    expect(view).not.toHaveProperty('customerPhone');
    expect(view).not.toHaveProperty('clientRequestId');
    expect(view.items[0]).not.toHaveProperty('id');
    expect(JSON.stringify(view)).not.toContain('9876543210');
  });

  it('#38 lists items in order_items.id order (the cart order)', () => {
    const view = toPublicOrderView(
      batchOrder({
        foodSubtotal: 430,
        total: 430,
        items: [
          { id: 9, itemName: 'Chicken Biryani', unitPrice: 150, quantity: 2, lineTotal: 300 },
          { id: 8, itemName: 'Paneer Biryani', unitPrice: 130, quantity: 1, lineTotal: 130 },
        ],
      }),
      null,
    );
    expect(view.items.map((i) => i.name)).toEqual(['Paneer Biryani', 'Chicken Biryani']);
  });
});

describe('mergeLines', () => {
  it('MG1 sums duplicate items and keeps each item at its first position', () => {
    const lines = [
      { menuItemId: 1, quantity: 2 },
      { menuItemId: 2, quantity: 1 },
      { menuItemId: 1, quantity: 3 },
    ];
    expect(mergeLines(lines)).toEqual([
      { menuItemId: 1, quantity: 5 },
      { menuItemId: 2, quantity: 1 },
    ]);
    expect(lines).toHaveLength(3); // input untouched
  });
});
