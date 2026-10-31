import { describe, expect, it } from 'vitest';
import { pathId } from '../../src/server/lib/path-id.js';
import {
  completeManySchema,
  menuItemCreateSchema,
  menuItemUpdateSchema,
  orderActionSchema,
  settingsUpdateSchema,
  slotCreateSchema,
} from '../../src/shared/schemas/admin.js';
import { adminOrderViewSchema } from '../../src/shared/schemas/admin-views.js';

describe('Admin schemas & pathId (Batch 6 Task 1)', () => {
  // AS1
  it('AS1 orderActionSchema accepts valid single actions and rejects invalid or mixed actions', () => {
    expect(orderActionSchema.safeParse({ status: 'CANCELLED' }).success).toBe(true);
    expect(orderActionSchema.safeParse({ paymentStatus: 'COLLECTED' }).success).toBe(true);

    expect(orderActionSchema.safeParse({}).success).toBe(false);
    expect(
      orderActionSchema.safeParse({ status: 'CANCELLED', paymentStatus: 'COLLECTED' }).success,
    ).toBe(false);
    expect(orderActionSchema.safeParse({ status: 'PAID' }).success).toBe(false);
    expect(
      orderActionSchema.safeParse({ status: 'CANCELLED', extra: 'key' }).success,
    ).toBe(false);
  });

  // AS2
  it('AS2 completeManySchema validates order IDs and rejects duplicates or out-of-range', () => {
    expect(
      completeManySchema.safeParse({ orderIds: [1, 2, 3], markCollected: true }).success,
    ).toBe(true);

    // empty array
    expect(completeManySchema.safeParse({ orderIds: [], markCollected: true }).success).toBe(false);

    // 201 ids
    const tooMany = Array.from({ length: 201 }, (_, i) => i + 1);
    expect(
      completeManySchema.safeParse({ orderIds: tooMany, markCollected: true }).success,
    ).toBe(false);

    // duplicates
    expect(
      completeManySchema.safeParse({ orderIds: [1, 2, 2], markCollected: true }).success,
    ).toBe(false);

    // 0 and -1
    expect(completeManySchema.safeParse({ orderIds: [0], markCollected: true }).success).toBe(false);
    expect(completeManySchema.safeParse({ orderIds: [-1], markCollected: true }).success).toBe(
      false,
    );
  });

  // AS3
  it('AS3 menu schemas validate inputs strictly and handle empty strings as null', () => {
    // price 0 rejected
    expect(menuItemCreateSchema.safeParse({ name: 'Biryani', price: 0 }).success).toBe(false);

    // http:// URL rejected
    expect(
      menuItemCreateSchema.safeParse({
        name: 'Biryani',
        price: 150,
        imageUrl: 'http://example.com/pic.jpg',
      }).success,
    ).toBe(false);

    // stockRemaining rejected (strict)
    expect(
      menuItemCreateSchema.safeParse({
        name: 'Biryani',
        price: 150,
        stockRemaining: 10,
      }).success,
    ).toBe(false);

    // empty description and image become null
    const parsed = menuItemCreateSchema.parse({
      name: 'Biryani',
      price: 150,
      description: '   ',
      imageUrl: '',
    });
    expect(parsed.description).toBeNull();
    expect(parsed.imageUrl).toBeNull();

    // empty update rejected
    expect(menuItemUpdateSchema.safeParse({}).success).toBe(false);
  });

  // AS4
  it('AS4 slotCreateSchema enforces cutoff < delivery and HH:MM format', () => {
    // cutoff equal to delivery
    const resEqual = slotCreateSchema.safeParse({
      locationId: 1,
      deliveryTime: '20:00',
      cutoffTime: '20:00',
    });
    expect(resEqual.success).toBe(false);
    if (!resEqual.success) {
      expect(resEqual.error.issues[0]?.path).toEqual(['cutoffTime']);
    }

    // cutoff after delivery
    const resAfter = slotCreateSchema.safeParse({
      locationId: 1,
      deliveryTime: '20:00',
      cutoffTime: '20:15',
    });
    expect(resAfter.success).toBe(false);

    // invalid time format '8:00'
    expect(
      slotCreateSchema.safeParse({
        locationId: 1,
        deliveryTime: '8:00',
        cutoffTime: '07:30',
      }).success,
    ).toBe(false);

    // valid slot
    expect(
      slotCreateSchema.safeParse({
        locationId: 1,
        deliveryTime: '20:00',
        cutoffTime: '19:30',
      }).success,
    ).toBe(true);
  });

  // AS5
  it('AS5 settingsUpdateSchema normalizes phone and validates bounds', () => {
    // phone normalization
    const res1 = settingsUpdateSchema.parse({
      contactPhone: '+91 98765 43210',
    });
    expect(res1.contactPhone).toBe('9876543210');

    // empty string -> null
    const res2 = settingsUpdateSchema.parse({
      contactPhone: '',
    });
    expect(res2.contactPhone).toBeNull();

    // invalid phone '12345'
    expect(settingsUpdateSchema.safeParse({ contactPhone: '12345' }).success).toBe(false);

    // expressFee 501 rejected (> FEE_MAX 500)
    expect(settingsUpdateSchema.safeParse({ expressFee: 501 }).success).toBe(false);

    // valid update
    expect(settingsUpdateSchema.safeParse({ expressFee: 50 }).success).toBe(true);
  });

  // AS6
  it('AS6 pathId parses valid positive integers and throws NOT_FOUND for invalid', () => {
    expect(pathId('57')).toBe(57);
    expect(pathId('1')).toBe(1);

    expect(() => pathId('0')).toThrowError('Not found.');
    expect(() => pathId('abc')).toThrowError('Not found.');
    expect(() => pathId('1e3')).toThrowError('Not found.');
    expect(() => pathId('2147483648')).toThrowError('Not found.');
    expect(() => pathId(undefined)).toThrowError('Not found.');
  });

  // AS7
  it('AS7 adminOrderViewSchema accepts valid admin view and rejects clientRequestId', () => {
    const validView = {
      id: 1,
      orderNumber: 'BB1001',
      status: 'ORDER_RECEIVED' as const,
      paymentMethod: 'COD' as const,
      paymentStatus: 'PENDING' as const,
      deliveryMode: 'BATCH' as const,
      deliveryDate: '2026-10-04',
      locationId: 1,
      locationName: 'MSH',
      slotId: 1,
      slotDeliveryTime: '20:00',
      expressWindow: null,
      isLate: false,
      customerName: 'Rahul Verma',
      customerPhone: '9876543210',
      addressDetail: 'Room 214',
      items: [
        {
          menuItemId: 1,
          name: 'Chicken Biryani',
          unitPrice: 150,
          quantity: 2,
          lineTotal: 300,
        },
      ],
      itemCount: 2,
      foodSubtotal: 300,
      deliveryFee: 0,
      total: 300,
      createdAt: '2026-10-04T13:40:00.000Z',
      completedAt: null,
      cancelledAt: null,
      collectedAt: null,
    };

    expect(adminOrderViewSchema.safeParse(validView).success).toBe(true);

    // Rejects with clientRequestId added
    expect(
      adminOrderViewSchema.safeParse({
        ...validView,
        clientRequestId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false);
  });
});
