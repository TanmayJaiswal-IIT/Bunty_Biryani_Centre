import { describe, expect, it } from 'vitest';
import { toPublicOrderView } from '../../src/server/services/order.service';
import { publicOrderViewSchema } from '../../src/shared/schemas/order';

describe('toPublicOrderView (Batch 5 §12.4 #38)', () => {
  it('shapes batch order correctly, omitting internal id and phone', () => {
    const rawOrder = {
      id: 999,
      clientRequestId: '11111111-1111-4111-8111-111111111111',
      orderNumber: 'BB1001',
      status: 'ORDER_RECEIVED' as const,
      paymentMethod: 'COD' as const,
      paymentStatus: 'PENDING' as const,
      deliveryMode: 'BATCH' as const,
      deliveryDate: new Date('2026-10-04T00:00:00.000Z'),
      locationId: 1,
      locationName: 'MSH',
      slotId: 1,
      slotDeliveryTime: '20:00',
      expressEtaMinMinutes: null,
      expressEtaMaxMinutes: null,
      customerName: 'Rahul Verma',
      customerPhone: '9876543210',
      addressDetail: 'Room 214',
      foodSubtotal: 300,
      deliveryFee: 0,
      total: 300,
      createdAt: new Date('2026-10-04T13:40:00.000Z'),
      updatedAt: new Date('2026-10-04T13:40:00.000Z'),
      completedAt: null,
      cancelledAt: null,
      collectedAt: null,
      items: [
        {
          id: 1,
          orderId: 999,
          menuItemId: 1,
          itemName: 'Chicken Biryani',
          unitPrice: 150,
          quantity: 2,
          lineTotal: 300,
        },
      ],
    };

    const view = toPublicOrderView(rawOrder, '9876500000');
    expect(publicOrderViewSchema.safeParse(view).success).toBe(true);

    expect(view.orderNumber).toBe('BB1001');
    expect(view.deliveryMode).toBe('BATCH');
    expect(view.slotDeliveryTime).toBe('20:00');
    expect(view.expressWindow).toBeNull();
    expect(view.contactPhone).toBe('9876500000');
    expect(view.deliveryDate).toBe('2026-10-04');
    expect(view.items).toEqual([
      { name: 'Chicken Biryani', unitPrice: 150, quantity: 2, lineTotal: 300 },
    ]);

    // Internal fields omitted
    expect('id' in view).toBe(false);
    expect('customerPhone' in view).toBe(false);
    expect('updatedAt' in view).toBe(false);
  });

  it('express order shapes 19:40-19:50 window for a 19:10 order with 30-40 ETA', () => {
    const rawOrder = {
      id: 1002,
      clientRequestId: '22222222-2222-4222-8222-222222222222',
      orderNumber: 'BB1002',
      status: 'ORDER_RECEIVED' as const,
      paymentMethod: 'COD' as const,
      paymentStatus: 'PENDING' as const,
      deliveryMode: 'EXPRESS' as const,
      deliveryDate: new Date('2026-10-04T00:00:00.000Z'),
      locationId: 2,
      locationName: 'Kanhar',
      slotId: null,
      slotDeliveryTime: null,
      expressEtaMinMinutes: 30,
      expressEtaMaxMinutes: 40,
      customerName: 'Rahul Verma',
      customerPhone: '9876543210',
      addressDetail: null,
      foodSubtotal: 300,
      deliveryFee: 30,
      total: 330,
      createdAt: new Date('2026-10-04T13:40:00.000Z'), // 19:10 IST
      updatedAt: new Date('2026-10-04T13:40:00.000Z'),
      completedAt: null,
      cancelledAt: null,
      collectedAt: null,
      items: [
        {
          id: 2,
          orderId: 1002,
          menuItemId: 1,
          itemName: 'Chicken Biryani',
          unitPrice: 150,
          quantity: 2,
          lineTotal: 300,
        },
      ],
    };

    const view = toPublicOrderView(rawOrder, null);
    expect(publicOrderViewSchema.safeParse(view).success).toBe(true);
    expect(view.expressWindow).toEqual({
      from: '19:40',
      to: '19:50',
      etaText: '30–40 minutes',
    });
  });

  it('express window across noon formats correctly', () => {
    // 11:50 IST = 06:20 UTC
    const rawOrder = {
      id: 1003,
      clientRequestId: '33333333-3333-4333-8333-333333333333',
      orderNumber: 'BB1003',
      status: 'ORDER_RECEIVED' as const,
      paymentMethod: 'COD' as const,
      paymentStatus: 'PENDING' as const,
      deliveryMode: 'EXPRESS' as const,
      deliveryDate: new Date('2026-10-04T00:00:00.000Z'),
      locationId: 2,
      locationName: 'Kanhar',
      slotId: null,
      slotDeliveryTime: null,
      expressEtaMinMinutes: 20,
      expressEtaMaxMinutes: 30,
      customerName: 'Rahul Verma',
      customerPhone: '9876543210',
      addressDetail: null,
      foodSubtotal: 150,
      deliveryFee: 30,
      total: 180,
      createdAt: new Date('2026-10-04T06:20:00.000Z'), // 11:50 IST
      updatedAt: new Date('2026-10-04T06:20:00.000Z'),
      completedAt: null,
      cancelledAt: null,
      collectedAt: null,
      items: [
        {
          id: 3,
          orderId: 1003,
          menuItemId: 1,
          itemName: 'Chicken Biryani',
          unitPrice: 150,
          quantity: 1,
          lineTotal: 150,
        },
      ],
    };

    const view = toPublicOrderView(rawOrder, null);
    expect(view.expressWindow).toEqual({
      from: '12:10',
      to: '12:20',
      etaText: '20–30 minutes',
    });
  });
});
