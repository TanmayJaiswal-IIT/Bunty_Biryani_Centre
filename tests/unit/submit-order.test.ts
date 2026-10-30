import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitOrder } from '../../src/client/features/customer/checkout/submit-order';
import { ApiError } from '../../src/client/lib/api';

describe('submitOrder unit tests', () => {
  const sampleRequest = {
    deliveryMode: 'BATCH' as const,
    slotId: 1,
    locationId: 1,
    clientRequestId: '00000000-0000-4000-8000-000000000001',
    customerName: 'Rahul Verma',
    customerPhone: '9876543210',
    addressDetail: 'Room 214',
    items: [{ menuItemId: 1, quantity: 2 }],
    expectedTotal: 300,
  };

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('submits order successfully on 201 response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () =>
        Promise.resolve({
          orderNumber: 'BB1001',
          status: 'ORDER_RECEIVED',
          total: 300,
          replayed: false,
        }),
    });

    const res = await submitOrder(sampleRequest);
    expect(res.orderNumber).toBe('BB1001');
    expect(res.replayed).toBe(false);
  });

  it('translates timeout / AbortError into NETWORK_ERROR', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url, options: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
    });

    // Test with short timeout
    await expect(submitOrder(sampleRequest, { timeoutMs: 50 })).rejects.toThrow(ApiError);
    try {
      await submitOrder(sampleRequest, { timeoutMs: 50 });
    } catch (err) {
      expect((err as ApiError).code).toBe('NETWORK_ERROR');
      expect((err as ApiError).message).toBe('Request timed out');
    }
  });
});
