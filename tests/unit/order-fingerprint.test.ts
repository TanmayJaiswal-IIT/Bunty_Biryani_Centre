import { beforeEach, describe, expect, it } from 'vitest';
import {
  FINGERPRINT_ID,
  PENDING_ORDER_KEY,
  clearPendingOrder,
  orderFingerprint,
  requestIdFor,
} from '../../src/client/features/customer/checkout/pending-order';
import type { CreateOrderOutput } from '../../src/shared/schemas/order';
import { withThrowingStorage, withWindowStorage } from '../helpers/markup';

type BatchRequest = Extract<CreateOrderOutput, { deliveryMode: 'BATCH' }>;

function req(over: Partial<BatchRequest> = {}): CreateOrderOutput {
  return {
    clientRequestId: '11111111-1111-4111-8111-111111111111',
    deliveryMode: 'BATCH',
    locationId: 1,
    slotId: 1,
    customerName: 'Asha',
    customerPhone: '9876543210',
    addressDetail: 'Room 12',
    items: [
      { menuItemId: 1, quantity: 2 },
      { menuItemId: 2, quantity: 1 },
    ],
    expectedTotal: 300,
    ...over,
  };
}

beforeEach(() => {
  clearPendingOrder();
});

describe('orderFingerprint', () => {
  it('#37 ignores the request id', () => {
    expect(orderFingerprint(req())).toBe(
      orderFingerprint(req({ clientRequestId: '22222222-2222-4222-8222-222222222222' })),
    );
  });

  it('#37 changes with every other field', () => {
    const base = orderFingerprint(req());
    const express: CreateOrderOutput = {
      clientRequestId: '11111111-1111-4111-8111-111111111111',
      deliveryMode: 'EXPRESS',
      locationId: 1,
      customerName: 'Asha',
      customerPhone: '9876543210',
      addressDetail: 'Room 12',
      items: [
        { menuItemId: 1, quantity: 2 },
        { menuItemId: 2, quantity: 1 },
      ],
      expectedTotal: 300,
    };
    const variants: CreateOrderOutput[] = [
      express,
      req({ slotId: 2 }),
      req({ locationId: 2 }),
      req({ customerName: 'Asha K' }),
      req({ customerPhone: '9876543211' }),
      req({ addressDetail: null }),
      req({
        items: [
          { menuItemId: 3, quantity: 2 },
          { menuItemId: 2, quantity: 1 },
        ],
      }),
      req({
        items: [
          { menuItemId: 1, quantity: 3 },
          { menuItemId: 2, quantity: 1 },
        ],
      }),
      req({ expectedTotal: 330 }),
    ];
    const prints = variants.map(orderFingerprint);
    for (const p of prints) expect(p).not.toBe(base);
    expect(new Set(prints).size).toBe(prints.length);
  });

  it('exports the placeholder id for the first build', () => {
    expect(FINGERPRINT_ID).toBe('00000000-0000-4000-8000-000000000000');
  });
});

describe('requestIdFor', () => {
  const fp = orderFingerprint(req());

  it('PO1 reuses the id for the same fingerprint', () => {
    withWindowStorage({}, () => {
      expect(requestIdFor(fp, () => 'id-1')).toBe('id-1');
      expect(requestIdFor(fp, () => 'id-2')).toBe('id-1');
    });
  });

  it('PO2 mints a new id for a new fingerprint', () => {
    withWindowStorage({}, () => {
      expect(requestIdFor(fp, () => 'id-1')).toBe('id-1');
      expect(requestIdFor(orderFingerprint(req({ expectedTotal: 999 })), () => 'id-2')).toBe(
        'id-2',
      );
    });
  });

  it('PO3 clearPendingOrder forgets the id', () => {
    withWindowStorage({}, () => {
      expect(requestIdFor(fp, () => 'id-1')).toBe('id-1');
      clearPendingOrder();
      expect(window.sessionStorage.getItem(PENDING_ORDER_KEY)).toBeNull();
      expect(requestIdFor(fp, () => 'id-2')).toBe('id-2');
      expect(window.sessionStorage.getItem(PENDING_ORDER_KEY)).not.toBeNull();
    });
  });

  it('PO4 still reuses the id from memory when storage throws', () => {
    withThrowingStorage(() => {
      expect(requestIdFor(fp, () => 'id-1')).toBe('id-1');
      expect(requestIdFor(fp, () => 'id-2')).toBe('id-1');
      clearPendingOrder();
      expect(requestIdFor(fp, () => 'id-3')).toBe('id-3');
    });
  });

  it('survives a reload: the stored id is used when memory is empty', () => {
    const stored = JSON.stringify({ clientRequestId: 'stored', fingerprint: fp });
    withWindowStorage({ session: { [PENDING_ORDER_KEY]: stored } }, () => {
      expect(requestIdFor(fp, () => 'fresh')).toBe('stored');
    });
  });

  it('ignores a corrupt stored value', () => {
    withWindowStorage({ session: { [PENDING_ORDER_KEY]: '{"junk":1}' } }, () => {
      expect(requestIdFor(fp, () => 'fresh')).toBe('fresh');
    });
  });
});
