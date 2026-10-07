import { describe, expect, it } from 'vitest';
import {
  createOrderResponseSchema,
  lookupSchema,
  orderNumberSchema,
  publicOrderViewSchema,
} from '../../src/shared/schemas/order';

const MESSAGE = 'Enter your order ID, like BB1023';

// The public order view example from Batch 1 §8.4, without `replayed`.
const view = {
  orderNumber: 'BB1023',
  status: 'ORDER_RECEIVED',
  paymentMethod: 'COD',
  paymentStatus: 'PENDING',
  deliveryMode: 'EXPRESS',
  deliveryDate: '2026-10-04',
  locationName: 'Kanhar',
  slotDeliveryTime: null,
  expressWindow: { from: '19:40', to: '19:50', etaText: '30–40 minutes' },
  customerName: 'Rahul Verma',
  addressDetail: 'Room 214, B block',
  items: [{ name: 'Chicken Biryani', unitPrice: 150, quantity: 2, lineTotal: 300 }],
  foodSubtotal: 300,
  deliveryFee: 30,
  total: 330,
  createdAt: '2026-10-04T13:40:12.000Z',
  contactPhone: '9876543210',
};

describe('orderNumberSchema', () => {
  it('#39 normalises bb1023, 1023 and " BB1023 " to BB1023', () => {
    for (const raw of ['bb1023', '1023', ' BB1023 ']) {
      expect(orderNumberSchema.parse(raw)).toBe('BB1023');
    }
  });

  it('#39 rejects XX1023, BB12, BB1234567890 and empty with the customer message', () => {
    for (const raw of ['XX1023', 'BB12', 'BB1234567890', '']) {
      const r = orderNumberSchema.safeParse(raw);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe(MESSAGE);
    }
  });
});

describe('lookupSchema', () => {
  it('LS1 normalises the phone and rejects an extra key', () => {
    expect(lookupSchema.parse({ orderNumber: 'bb1023', phone: '+91 98765-43210' })).toEqual({
      orderNumber: 'BB1023',
      phone: '9876543210',
    });
    expect(
      lookupSchema.safeParse({ orderNumber: 'BB1023', phone: '9876543210', extra: 1 }).success,
    ).toBe(false);
  });
});

describe('publicOrderViewSchema', () => {
  it('LS2 accepts the Batch 1 §8.4 example', () => {
    expect(publicOrderViewSchema.safeParse(view).success).toBe(true);
    expect(createOrderResponseSchema.safeParse({ ...view, replayed: false }).success).toBe(true);
    expect(createOrderResponseSchema.safeParse(view).success).toBe(false);
  });

  it('LS2 accepts a batch order with a slot time and no contact phone', () => {
    const batch = {
      ...view,
      deliveryMode: 'BATCH',
      slotDeliveryTime: '20:00',
      expressWindow: null,
    };
    expect(publicOrderViewSchema.safeParse({ ...batch, contactPhone: null }).success).toBe(true);
  });

  it('LS2 rejects an internal id or the customer phone', () => {
    expect(publicOrderViewSchema.safeParse({ ...view, id: 57 }).success).toBe(false);
    expect(publicOrderViewSchema.safeParse({ ...view, customerPhone: '9876543210' }).success).toBe(
      false,
    );
  });
});
