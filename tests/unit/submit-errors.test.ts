import { describe, expect, it } from 'vitest';
import { describeSubmitError } from '../../src/client/features/customer/checkout/error-handling';
import { ApiError } from '../../src/client/lib/api';
import type { ErrorCode } from '../../src/shared/errors';
import type { CreateOrderOutput } from '../../src/shared/schemas/order';
import { opts } from '../helpers/delivery-fixtures';

const batch: CreateOrderOutput = {
  clientRequestId: '11111111-1111-4111-8111-111111111111',
  deliveryMode: 'BATCH',
  locationId: 1,
  slotId: 1,
  customerName: 'Asha',
  customerPhone: '9876543210',
  addressDetail: null,
  items: [
    { menuItemId: 7, quantity: 3 },
    { menuItemId: 8, quantity: 1 },
  ],
  expectedTotal: 450,
};

function err(
  code: ErrorCode | 'NETWORK_ERROR',
  details?: Record<string, unknown>,
  status = 409,
): ApiError {
  return new ApiError(status, code, 'server message', details);
}

function describeIt(
  error: ApiError,
  over: { request?: CreateOrderOutput; options?: ReturnType<typeof opts> | undefined } = {},
) {
  return describeSubmitError(error, {
    request: over.request ?? batch,
    options: 'options' in over ? over.options : opts(),
  });
}

describe('describeSubmitError', () => {
  it('has neutral defaults', () => {
    const f = describeIt(err('RATE_LIMITED', undefined, 429));
    expect(f).toEqual({
      banner: 'Too many attempts. Please wait a minute and try again.',
      bannerExtra: null,
      fieldErrors: {},
      revalidateMenu: false,
      revalidateOptions: false,
      selection: 'keep',
      stockFixes: [],
      tryExpressLocationId: null,
      showContact: false,
      newRequestId: false,
      retryable: false,
    });
  });

  it('VALIDATION_ERROR with fieldErrors maps the first message per known field', () => {
    const f = describeIt(
      err(
        'VALIDATION_ERROR',
        {
          fieldErrors: {
            customerPhone: ['Enter a 10-digit mobile number', 'second'],
            customerName: ['Enter your name'],
            somethingElse: ['Odd'],
            items: [],
          },
        },
        400,
      ),
    );
    expect(f.banner).toBeNull();
    expect(f.fieldErrors).toEqual({
      customerPhone: 'Enter a 10-digit mobile number',
      customerName: 'Enter your name',
      deliveryMode: 'Odd',
    });
  });

  it('VALIDATION_ERROR without fieldErrors is a generic banner', () => {
    const f = describeIt(err('VALIDATION_ERROR', undefined, 400));
    expect(f.banner).toBe('Something went wrong. Please try again.');
    expect(f.fieldErrors).toEqual({});
    expect(f.retryable).toBe(false);
  });

  it('ORDERS_PAUSED', () => {
    const f = describeIt(err('ORDERS_PAUSED'));
    expect(f.banner).toBe('Orders are temporarily paused. Please check again shortly.');
    expect(f.revalidateOptions).toBe(true);
    expect(f.revalidateMenu).toBe(false);
  });

  it('SLOT_CLOSED with express available', () => {
    const f = describeIt(err('SLOT_CLOSED', { reason: 'CUTOFF_PASSED', expressAvailable: true }));
    expect(f.banner).toBe('Orders for MSH — 8:00 PM just closed.');
    expect(f.bannerExtra).toBe('Batch orders for MSH are closed. Express delivery is available.');
    expect(f.selection).toBe('clearSlot');
    expect(f.revalidateOptions).toBe(true);
    expect(f.tryExpressLocationId).toBe(1);
  });

  it('SLOT_CLOSED without express', () => {
    const f = describeIt(err('SLOT_CLOSED', { reason: 'CUTOFF_PASSED', expressAvailable: false }));
    expect(f.banner).toBe('Orders for MSH — 8:00 PM just closed.');
    expect(f.bannerExtra).toBeNull();
    expect(f.tryExpressLocationId).toBeNull();
    expect(f.selection).toBe('clearSlot');
  });

  it('SLOT_CLOSED for a slot missing from the options falls back to the plain message', () => {
    const f = describeIt(err('SLOT_CLOSED', { expressAvailable: false }), {
      request: { ...batch, slotId: 99 },
    });
    expect(f.banner).toBe('Orders for this delivery slot are closed.');
    const g = describeIt(err('SLOT_CLOSED', { expressAvailable: false }), { options: undefined });
    expect(g.banner).toBe('Orders for this delivery slot are closed.');
  });

  it('LOCATION_UNAVAILABLE', () => {
    const f = describeIt(err('LOCATION_UNAVAILABLE'));
    expect(f.banner).toBe(
      "Delivery to this location isn't available right now. Please choose another.",
    );
    expect(f.selection).toBe('clearLocation');
    expect(f.revalidateOptions).toBe(true);
  });

  it('EXPRESS_UNAVAILABLE', () => {
    const f = describeIt(err('EXPRESS_UNAVAILABLE', { reason: 'CLOSED_HOURS' }));
    expect(f.banner).toBe('Express delivery is currently unavailable.');
    expect(f.selection).toBe('clearMethod');
    expect(f.revalidateOptions).toBe(true);
  });

  it('ITEM_UNAVAILABLE removes each listed item', () => {
    const f = describeIt(
      err('ITEM_UNAVAILABLE', { items: [{ menuItemId: 7 }, { menuItemId: 8 }] }),
    );
    expect(f.banner).toBe(
      'Some items are no longer available and were removed. Please check your order.',
    );
    expect(f.stockFixes).toEqual([
      { menuItemId: 7, available: 0 },
      { menuItemId: 8, available: 0 },
    ]);
    expect(f.revalidateMenu).toBe(true);
  });

  it('OUT_OF_STOCK with a capped item', () => {
    const f = describeIt(
      err('OUT_OF_STOCK', { items: [{ menuItemId: 7, name: 'Chicken Biryani', available: 2 }] }),
    );
    expect(f.banner).toBe(
      "Only 2 Chicken Biryani left. We've updated your order. Please check it and place it again.",
    );
    expect(f.stockFixes).toEqual([{ menuItemId: 7, available: 2 }]);
    expect(f.revalidateMenu).toBe(true);
  });

  it('OUT_OF_STOCK with a sold-out item', () => {
    const f = describeIt(
      err('OUT_OF_STOCK', { items: [{ menuItemId: 7, name: 'Chicken Biryani', available: 0 }] }),
    );
    expect(f.banner).toBe('Chicken Biryani just sold out and was removed.');
    expect(f.stockFixes).toEqual([{ menuItemId: 7, available: 0 }]);
  });

  it('OUT_OF_STOCK with several items has one sentence each, then the update line', () => {
    const f = describeIt(
      err('OUT_OF_STOCK', {
        items: [
          { menuItemId: 7, name: 'Chicken Biryani', available: 2 },
          { menuItemId: 8, name: 'Paneer Biryani', available: 0 },
        ],
      }),
    );
    expect(f.banner).toBe(
      "Only 2 Chicken Biryani left. Paneer Biryani just sold out and was removed. We've updated your order. Please check it and place it again.",
    );
    expect(f.stockFixes).toEqual([
      { menuItemId: 7, available: 2 },
      { menuItemId: 8, available: 0 },
    ]);
  });

  it('OUT_OF_STOCK with unreadable details still revalidates the menu', () => {
    const f = describeIt(err('OUT_OF_STOCK', { items: 'nope' }));
    expect(f.banner).toBe(
      'Some items are no longer available and were removed. Please check your order.',
    );
    expect(f.revalidateMenu).toBe(true);
    expect(f.stockFixes).toEqual([]);
  });

  it('PRICE_CHANGED', () => {
    const f = describeIt(err('PRICE_CHANGED', { total: 480 }));
    expect(f.banner).toBe(
      'Prices changed since you opened the menu. Please check the new total and place your order again.',
    );
    expect(f.revalidateMenu).toBe(true);
    expect(f.revalidateOptions).toBe(true);
  });

  it('TOO_MANY_OPEN_ORDERS shows the contact only when it is set', () => {
    const withPhone = describeIt(err('TOO_MANY_OPEN_ORDERS', { limit: 3 }, 429), {
      options: opts({ contactPhone: '9876543210' }),
    });
    expect(withPhone.banner).toBe(
      'You already have 3 orders waiting for delivery today. Please wait for them to arrive or contact Bunty Biryani Centre.',
    );
    expect(withPhone.showContact).toBe(true);
    expect(describeIt(err('TOO_MANY_OPEN_ORDERS', { limit: 3 }, 429)).showContact).toBe(false);
    expect(
      describeIt(err('TOO_MANY_OPEN_ORDERS', { limit: 3 }, 429), { options: undefined })
        .showContact,
    ).toBe(false);
  });

  it('TOO_MANY_OPEN_ORDERS falls back to the shared limit', () => {
    expect(describeIt(err('TOO_MANY_OPEN_ORDERS', undefined, 429)).banner).toContain(
      'You already have 3 orders',
    );
  });

  it('IDEMPOTENCY_CONFLICT asks for a new id', () => {
    const f = describeIt(err('IDEMPOTENCY_CONFLICT'));
    expect(f.banner).toBe('Something went wrong. Please tap Place order again.');
    expect(f.newRequestId).toBe(true);
    expect(f.retryable).toBe(false);
  });

  it('RATE_LIMITED has no actions', () => {
    const f = describeIt(err('RATE_LIMITED', undefined, 429));
    expect(f.banner).toBe('Too many attempts. Please wait a minute and try again.');
    expect(f.retryable).toBe(false);
    expect(f.revalidateMenu || f.revalidateOptions).toBe(false);
  });

  it('INTERNAL_ERROR (500) is retryable', () => {
    const f = describeIt(err('INTERNAL_ERROR', undefined, 500));
    expect(f.banner).toBe(
      "We couldn't confirm your order. Check your connection and tap Try again. You won't get a duplicate order.",
    );
    expect(f.retryable).toBe(true);
  });

  it('NETWORK_ERROR (0) is retryable', () => {
    const f = describeIt(err('NETWORK_ERROR', undefined, 0));
    expect(f.retryable).toBe(true);
    expect(f.banner).toContain('tap Try again');
  });

  it('an unexpected code is retryable too', () => {
    const f = describeIt(err('NOT_FOUND', undefined, 404));
    expect(f.retryable).toBe(true);
    expect(f.banner).toContain('tap Try again');
  });
});
