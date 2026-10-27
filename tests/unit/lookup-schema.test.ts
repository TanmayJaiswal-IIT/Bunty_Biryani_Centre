import { describe, expect, it } from 'vitest';
import { lookupSchema, orderNumberSchema } from '../../src/shared/schemas/order';

describe('lookupSchema (Batch 5 §12.4 #39)', () => {
  it('normalizes order numbers: bb1023, 1023,  BB1023  -> BB1023', () => {
    expect(orderNumberSchema.parse('bb1023')).toBe('BB1023');
    expect(orderNumberSchema.parse('1023')).toBe('BB1023');
    expect(orderNumberSchema.parse('  BB1023  ')).toBe('BB1023');
    expect(orderNumberSchema.parse('  1023  ')).toBe('BB1023');
  });

  it('rejects invalid order numbers: XX1023, BB12', () => {
    expect(orderNumberSchema.safeParse('XX1023').success).toBe(false);
    expect(orderNumberSchema.safeParse('BB12').success).toBe(false);
    expect(orderNumberSchema.safeParse('').success).toBe(false);
    expect(orderNumberSchema.safeParse('BBabc').success).toBe(false);
  });

  it('lookupSchema normalizes valid inputs and mobile numbers', () => {
    const res = lookupSchema.parse({
      orderNumber: 'bb1023',
      phone: '+91 98765-43210',
    });
    expect(res).toEqual({
      orderNumber: 'BB1023',
      phone: '9876543210',
    });
  });

  it('lookupSchema rejects invalid phone', () => {
    expect(
      lookupSchema.safeParse({
        orderNumber: 'BB1023',
        phone: '12345',
      }).success,
    ).toBe(false);
  });
});
