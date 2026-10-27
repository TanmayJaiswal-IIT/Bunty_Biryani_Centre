import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingOrder,
  computeOrderFingerprint,
  ensureClientRequestId,
  getPendingOrder,
} from '../../src/client/features/customer/checkout/pending-order';

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
}

const baseReq = {
  deliveryMode: 'BATCH' as const,
  slotId: 1,
  locationId: 1,
  customerName: 'Rahul Verma',
  customerPhone: '9876543210',
  addressDetail: 'Room 214',
  items: [{ menuItemId: 1, quantity: 2 }],
  expectedTotal: 300,
};

describe('Order fingerprint & pending id (Batch 5 §12.4 #37, PO1–PO4)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      sessionStorage: fakeStorage(),
    });
    clearPendingOrder();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('identical requests produce identical fingerprint', () => {
    const fp1 = computeOrderFingerprint(baseReq);
    const fp2 = computeOrderFingerprint({ ...baseReq });
    expect(fp1).toBe(fp2);
  });

  it('changing any field changes the fingerprint', () => {
    const base = computeOrderFingerprint(baseReq);

    expect(computeOrderFingerprint({ ...baseReq, deliveryMode: 'EXPRESS' })).not.toBe(base);
    expect(computeOrderFingerprint({ ...baseReq, slotId: 2 })).not.toBe(base);
    expect(computeOrderFingerprint({ ...baseReq, locationId: 2 })).not.toBe(base);
    expect(computeOrderFingerprint({ ...baseReq, customerName: 'Aman' })).not.toBe(base);
    expect(computeOrderFingerprint({ ...baseReq, customerPhone: '9876543211' })).not.toBe(base);
    expect(computeOrderFingerprint({ ...baseReq, addressDetail: 'Room 215' })).not.toBe(base);
    expect(
      computeOrderFingerprint({ ...baseReq, items: [{ menuItemId: 1, quantity: 3 }] }),
    ).not.toBe(base);
    expect(computeOrderFingerprint({ ...baseReq, expectedTotal: 350 })).not.toBe(base);
  });

  it('reuses clientRequestId when fingerprint matches (PO1)', () => {
    const { clientRequestId: id1 } = ensureClientRequestId(baseReq);
    const { clientRequestId: id2 } = ensureClientRequestId(baseReq);
    expect(id1).toBe(id2);
  });

  it('mints new clientRequestId when fingerprint changes (PO2)', () => {
    const { clientRequestId: id1 } = ensureClientRequestId(baseReq);
    const { clientRequestId: id2 } = ensureClientRequestId({
      ...baseReq,
      customerName: 'Different Name',
    });
    expect(id1).not.toBe(id2);
  });

  it('clears pending order on clearPendingOrder (PO3)', () => {
    ensureClientRequestId(baseReq);
    expect(getPendingOrder()).not.toBeNull();
    clearPendingOrder();
    expect(getPendingOrder()).toBeNull();
  });

  it('works and persists in module memory even if sessionStorage is blocked (PO4)', () => {
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceeded or Blocked');
        },
        removeItem: () => undefined,
        clear: () => undefined,
      },
    });

    const { clientRequestId: id1 } = ensureClientRequestId(baseReq);
    const { clientRequestId: id2 } = ensureClientRequestId(baseReq);
    expect(id1).toBe(id2);
  });
});
