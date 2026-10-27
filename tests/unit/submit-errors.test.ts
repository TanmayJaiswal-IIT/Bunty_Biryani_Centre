import { describe, expect, it } from 'vitest';
import {
  formatOutOfStockMessage,
  parseCheckoutError,
} from '../../src/client/features/customer/checkout/error-handling';
import { ApiError } from '../../src/client/lib/api';

describe('Submit errors mapping (Batch 5 §7.3, §12.4)', () => {
  it('formats single-item OUT_OF_STOCK capped message', () => {
    const msg = formatOutOfStockMessage([
      { menuItemId: 1, name: 'Chicken Biryani', available: 2 },
    ]);
    expect(msg).toBe(
      "Only 2 Chicken Biryani left. We've updated your order. Please check it and place it again.",
    );
  });

  it('formats single-item OUT_OF_STOCK sold out message', () => {
    const msg = formatOutOfStockMessage([
      { menuItemId: 1, name: 'Chicken Biryani', available: 0 },
    ]);
    expect(msg).toBe('Chicken Biryani just sold out and was removed.');
  });

  it('formats multi-item OUT_OF_STOCK message with combined sentences', () => {
    const msg = formatOutOfStockMessage([
      { menuItemId: 1, name: 'Chicken Biryani', available: 2 },
      { menuItemId: 2, name: 'Paneer Biryani', available: 0 },
    ]);
    expect(msg).toBe(
      "Only 2 Chicken Biryani left. Paneer Biryani just sold out and was removed. We've updated your order. Please check it and place it again.",
    );
  });

  it('maps VALIDATION_ERROR fieldErrors', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'Validation failed', {
      fieldErrors: { customerName: ['Enter your name'] },
    });
    const parsed = parseCheckoutError(err);
    expect(parsed.fieldErrors).toEqual({ customerName: 'Enter your name' });
  });

  it('maps ORDERS_PAUSED error', () => {
    const err = new ApiError(409, 'ORDERS_PAUSED', 'Paused');
    const parsed = parseCheckoutError(err);
    expect(parsed.banner.message).toBe(
      'Orders are temporarily paused. Please check again shortly.',
    );
    expect(parsed.revalidateOptions).toBe(true);
  });

  it('maps SLOT_CLOSED with expressAvailable', () => {
    const err = new ApiError(409, 'SLOT_CLOSED', 'Closed', {
      slotName: 'MSH — 8:00 PM',
      locationName: 'MSH',
      expressAvailable: true,
    });
    const parsed = parseCheckoutError(err);
    expect(parsed.banner.message).toContain('Orders for MSH — 8:00 PM just closed.');
    expect(parsed.banner.message).toContain(
      'Batch orders for MSH are closed. Express delivery is available.',
    );
    expect(parsed.banner.tryExpress).toBe(true);
    expect(parsed.clearSlot).toBe(true);
  });

  it('maps LOCATION_UNAVAILABLE error', () => {
    const err = new ApiError(409, 'LOCATION_UNAVAILABLE', 'Location unavailable');
    const parsed = parseCheckoutError(err);
    expect(parsed.banner.message).toBe(
      "Delivery to this location isn't available right now. Please choose another.",
    );
    expect(parsed.clearLocation).toBe(true);
  });

  it('maps EXPRESS_UNAVAILABLE error', () => {
    const err = new ApiError(409, 'EXPRESS_UNAVAILABLE', 'Express unavailable');
    const parsed = parseCheckoutError(err);
    expect(parsed.banner.message).toBe('Express delivery is currently unavailable.');
    expect(parsed.clearMethod).toBe(true);
  });

  it('maps ITEM_UNAVAILABLE error', () => {
    const err = new ApiError(409, 'ITEM_UNAVAILABLE', 'Item unavailable');
    const parsed = parseCheckoutError(err);
    expect(parsed.banner.message).toBe(
      'Some items are no longer available and were removed. Please check your order.',
    );
    expect(parsed.revalidateMenu).toBe(true);
  });

  it('maps PRICE_CHANGED error', () => {
    const err = new ApiError(409, 'PRICE_CHANGED', 'Price changed', { total: 320 });
    const parsed = parseCheckoutError(err);
    expect(parsed.banner.message).toBe(
      'Prices changed since you opened the menu. Please check the new total and place your order again.',
    );
    expect(parsed.banner.variant).toBe('warning');
    expect(parsed.revalidateMenu).toBe(true);
  });

  it('maps TOO_MANY_OPEN_ORDERS with contact phone', () => {
    const err = new ApiError(429, 'TOO_MANY_OPEN_ORDERS', 'Cap reached');
    const parsed = parseCheckoutError(err, '9876500000');
    expect(parsed.banner.message).toContain(
      'You already have 3 orders waiting for delivery today. Please wait for them to arrive or contact Bunty Biryani Centre.',
    );
    expect(parsed.banner.message).toContain('Call 9876500000');
  });

  it('maps IDEMPOTENCY_CONFLICT with newIdRequired', () => {
    const err = new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Conflict');
    const parsed = parseCheckoutError(err);
    expect(parsed.banner.message).toBe('Something went wrong. Please tap Place order again.');
    expect(parsed.newIdRequired).toBe(true);
  });

  it('maps RATE_LIMITED error', () => {
    const err = new ApiError(429, 'RATE_LIMITED', 'Rate limited');
    const parsed = parseCheckoutError(err);
    expect(parsed.banner.message).toBe('Too many attempts. Please wait a minute and try again.');
  });

  it('maps network and 500 errors to try again network banner with isNetworkOrServer', () => {
    const netErr = new ApiError(0, 'NETWORK_ERROR', 'Network failure');
    const parsedNet = parseCheckoutError(netErr);
    expect(parsedNet.isNetworkOrServer).toBe(true);
    expect(parsedNet.banner.message).toContain(
      "We couldn't confirm your order. Check your connection and tap Try again. You won't get a duplicate order.",
    );

    const srvErr = new ApiError(500, 'INTERNAL_ERROR', 'Server crash');
    const parsedSrv = parseCheckoutError(srvErr);
    expect(parsedSrv.isNetworkOrServer).toBe(true);
  });
});
