import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/client/lib/api';
import {
  SUBMIT_TIMEOUT_MS,
  menuMayReconcile,
  submitButtonState,
  submitOrder,
} from '../../src/client/features/customer/checkout/submit-order';
import type { CreateOrderOutput } from '../../src/shared/schemas/order';
import { closedSlot, opts } from '../helpers/delivery-fixtures';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const request: CreateOrderOutput = {
  clientRequestId: '11111111-1111-4111-8111-111111111111',
  deliveryMode: 'EXPRESS',
  locationId: 1,
  customerName: 'Asha',
  customerPhone: '9876543210',
  addressDetail: null,
  items: [{ menuItemId: 1, quantity: 1 }],
  expectedTotal: 180,
};

describe('submitOrder', () => {
  it('SO1 times out after 15 s as NETWORK_ERROR', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    expect(SUBMIT_TIMEOUT_MS).toBe(15_000);

    let outcome: unknown = 'pending';
    const result = submitOrder(request, 15_000);
    result.then(
      (value) => {
        outcome = value;
      },
      (error: unknown) => {
        outcome = error;
      },
    );

    await vi.advanceTimersByTimeAsync(14_999);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBeInstanceOf(ApiError);
    expect(outcome).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('posts the request and returns the response', async () => {
    const body = { orderNumber: 'BB1023', replayed: false };
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 201 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(submitOrder(request)).resolves.toEqual(body);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/orders');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(request);
  });

  it('passes a server error through as an ApiError', async () => {
    const body = { error: { code: 'PRICE_CHANGED', message: 'x', details: { total: 200 } } };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 409 }))),
    );
    await expect(submitOrder(request)).rejects.toMatchObject({
      status: 409,
      code: 'PRICE_CHANGED',
    });
  });
});

describe('submitButtonState', () => {
  const total = 330;
  const nothingOpen = () =>
    opts({
      slots: { 1: closedSlot(), 2: closedSlot() },
      express: { available: false },
    });

  it('SB1 submitting is disabled and loading', () => {
    expect(
      submitButtonState({ submitting: true, retrying: false, options: opts(), total }),
    ).toEqual({ disabled: true, loading: true, label: 'Placing order…' });
  });

  it('SB2 no options yet is disabled with the price label', () => {
    expect(
      submitButtonState({ submitting: false, retrying: false, options: undefined, total }),
    ).toEqual({ disabled: true, loading: false, label: 'Place order · ₹330' });
  });

  it('SB3 retrying stays enabled even when paused', () => {
    expect(
      submitButtonState({
        submitting: false,
        retrying: true,
        options: opts({ ordersPaused: true }),
        total,
      }),
    ).toEqual({ disabled: false, loading: false, label: 'Try again' });
  });

  it('SB3 retrying stays enabled when nothing is open', () => {
    expect(
      submitButtonState({ submitting: false, retrying: true, options: nothingOpen(), total })
        .disabled,
    ).toBe(false);
  });

  it('SB4 paused is disabled', () => {
    expect(
      submitButtonState({
        submitting: false,
        retrying: false,
        options: opts({ ordersPaused: true }),
        total,
      }),
    ).toEqual({ disabled: true, loading: false, label: 'Orders are paused' });
  });

  it('SB4 nothing open is disabled; anything open is enabled', () => {
    expect(
      submitButtonState({ submitting: false, retrying: false, options: nothingOpen(), total }),
    ).toEqual({ disabled: true, loading: false, label: 'Place order · ₹330' });
    expect(
      submitButtonState({ submitting: false, retrying: false, options: opts(), total }),
    ).toEqual({ disabled: false, loading: false, label: 'Place order · ₹330' });
  });
});

describe('menuMayReconcile', () => {
  // The order in flight (or kept for Try again) may have sold out the cart itself; reconciling
  // would empty it and redirect away from checkout, losing Try again (Batch 5 §7.2).
  it('MR1 reconciles only when nothing is in flight and nothing is frozen', () => {
    expect(menuMayReconcile({ submitting: false, frozen: false })).toBe(true);
    expect(menuMayReconcile({ submitting: true, frozen: false })).toBe(false);
    expect(menuMayReconcile({ submitting: false, frozen: true })).toBe(false);
    expect(menuMayReconcile({ submitting: true, frozen: true })).toBe(false);
  });
});
