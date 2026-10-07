// Confirmation / status page, track page and recent orders (Batch 5 Task 8). Static markup in the
// node unit project: SWR serves its `fallback` / `fallbackData` without fetching.
import { createElement as h, type ReactElement } from 'react';
import { Route, Routes } from 'react-router';
import { SWRConfig } from 'swr';
import { describe, expect, it } from 'vitest';
import type { PublicMenu, PublicOrderView } from '../../src/shared/api-types';
import { CartProvider } from '../../src/client/features/customer/cart/CartProvider';
import { MENU_KEY } from '../../src/client/features/customer/menu/use-menu';
import { OrderDetails } from '../../src/client/features/customer/order/OrderDetails';
import { deliveryWhen } from '../../src/client/features/customer/order/order-display';
import { parseOrderState } from '../../src/client/features/customer/order/order-state';
import { OrderPage } from '../../src/client/features/customer/order/OrderPage';
import { RECENT_ORDERS_KEY } from '../../src/client/features/customer/order/recent-orders-storage';
import { TrackPage } from '../../src/client/features/customer/order/TrackPage';
import { orderLookupSwrOptions } from '../../src/client/features/customer/order/use-order-lookup';
import { RouteErrorBoundary, RouteLoadError } from '../../src/client/components/RouteErrorBoundary';
import { escaped, item, render, withWindowStorage } from '../helpers/markup';

const BATCH: PublicOrderView = {
  orderNumber: 'BB1023',
  status: 'ORDER_RECEIVED',
  paymentMethod: 'COD',
  paymentStatus: 'PENDING',
  deliveryMode: 'BATCH',
  deliveryDate: '2026-10-04',
  locationName: 'MSH',
  slotDeliveryTime: '20:00',
  expressWindow: null,
  customerName: 'Rahul Verma',
  addressDetail: 'Room 214, B block',
  items: [{ name: 'Chicken Biryani', unitPrice: 150, quantity: 2, lineTotal: 300 }],
  foodSubtotal: 300,
  deliveryFee: 0,
  total: 300,
  createdAt: '2026-10-04T13:40:00.000Z',
  contactPhone: '9876543210',
};

const EXPRESS: PublicOrderView = {
  ...BATCH,
  deliveryMode: 'EXPRESS',
  locationName: 'Kanhar',
  slotDeliveryTime: null,
  expressWindow: { from: '19:40', to: '19:50', etaText: '30–40 minutes' },
  deliveryFee: 30,
  total: 330,
};

const TODAY = '2026-10-04';
const MENU: PublicMenu = { businessDate: TODAY, ordersPaused: false, items: [item()] };

describe('parseOrderState', () => {
  const state = { order: BATCH, phone: '9123456780', placed: true };

  it('OS1: accepts a valid state, ignoring the `replayed` flag of a create response', () => {
    expect(parseOrderState(state, 'BB1023')).toEqual(state);
    expect(parseOrderState({ ...state, order: { ...BATCH, replayed: false } }, 'BB1023')).toEqual(
      state,
    );
  });

  it('OS2: a state for another order number is ignored', () => {
    const other = { ...state, order: { ...BATCH, orderNumber: 'BB1002' } };
    expect(parseOrderState(other, 'BB1001')).toBeNull();
  });

  it('OS3: malformed states are ignored', () => {
    const noItems: Record<string, unknown> = { ...BATCH };
    delete noItems.items;
    expect(parseOrderState({ ...state, order: noItems }, 'BB1023')).toBeNull();
    expect(parseOrderState({ ...state, order: { ...BATCH, id: 7 } }, 'BB1023')).toBeNull();
    expect(parseOrderState({ ...state, phone: '123' }, 'BB1023')).toBeNull();
    expect(parseOrderState({ ...state, placed: 'yes' }, 'BB1023')).toBeNull();
    for (const junk of [null, undefined, 'x', 5, [], {}]) {
      expect(parseOrderState(junk, 'BB1023')).toBeNull();
    }
  });
});

describe('orderLookupSwrOptions', () => {
  it('OS4: never retries on error, and refreshes every 60 s only while the order is received', () => {
    const options = orderLookupSwrOptions(undefined);
    expect(options.shouldRetryOnError).toBe(false);
    expect(options.revalidateOnMount).toBe(true);
    expect(options.revalidateOnFocus).toBe(true);
    // Router state may be stale (history survives reloads), so it is always re-checked.
    expect(orderLookupSwrOptions(BATCH).revalidateOnMount).toBe(true);
    expect(orderLookupSwrOptions(BATCH).fallbackData).toBe(BATCH);
    const interval = options.refreshInterval;
    if (typeof interval !== 'function') throw new Error('refreshInterval must be a function');
    expect(interval(BATCH)).toBe(60_000);
    expect(interval({ ...BATCH, status: 'COMPLETED' })).toBe(0);
    expect(interval({ ...BATCH, status: 'CANCELLED' })).toBe(0);
    expect(interval(undefined)).toBe(0);
  });

  it('OS4: the poll also runs for an order that came from router state (empty cache)', () => {
    // SWR passes the cache entry, which is empty until the first fetch: the fallback decides.
    const received = orderLookupSwrOptions(BATCH).refreshInterval;
    const completed = orderLookupSwrOptions({ ...BATCH, status: 'COMPLETED' }).refreshInterval;
    if (typeof received !== 'function' || typeof completed !== 'function') {
      throw new Error('refreshInterval must be a function');
    }
    expect(received(undefined)).toBe(60_000);
    expect(completed(undefined)).toBe(0);
    // Once fetched, the fresh data wins over the stale fallback.
    expect(received({ ...BATCH, status: 'CANCELLED' })).toBe(0);
    expect(completed(BATCH)).toBe(60_000);
  });
});

describe('deliveryWhen', () => {
  it('OD1: batch is "Today" on the business date, dated otherwise or when it is unknown', () => {
    expect(deliveryWhen(BATCH, TODAY)).toBe('Today, 8:00 PM');
    expect(deliveryWhen(BATCH, '2026-10-05')).toBe('Sun, 4 Oct, 8:00 PM');
    expect(deliveryWhen(BATCH, null)).toBe('Sun, 4 Oct, 8:00 PM');
  });

  it('OD1: express is an approximate window, with the date only when it is not today', () => {
    expect(deliveryWhen(EXPRESS, TODAY)).toBe('Approx. 30–40 minutes (around 7:40–7:50 PM)');
    expect(deliveryWhen(EXPRESS, '2026-10-05')).toBe(
      'Sun, 4 Oct, Approx. 30–40 minutes (around 7:40–7:50 PM)',
    );
  });
});

describe('OrderDetails', () => {
  const details = (order: PublicOrderView, placed: boolean) =>
    render(h(OrderDetails, { order, placed, businessDate: TODAY }));

  it('OD2: a placed batch order shows the confirmation layout', () => {
    const html = details(BATCH, true);
    for (const text of [
      'ORDER PLACED',
      'Your order ID',
      'BB1023',
      'Keep this ID to check your order.',
      'Batch · MSH',
      'Today, 8:00 PM',
      'Room 214, B block',
      'Chicken Biryani × 2',
      '₹300',
      'Free',
      'Payment: CASH ON DELIVERY',
      'Pay ₹300 in cash when your food arrives.',
      'Need help?',
      'Call 98765 43210',
      'Order more',
      'Track an order',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('href="tel:9876543210"');
    expect(html).toContain('href="/track"');
    expect(html).toContain('>Copy<');
    // The ID is selectable.
    expect(html).toMatch(/class="[^"]*select-all[^"]*"[^>]*>BB1023</);
  });

  it('OD2: an express order shows the method, the approximate window and the fee', () => {
    const html = details(EXPRESS, true);
    expect(html).toContain('Express · Kanhar');
    expect(html).toContain('Approx. 30–40 minutes (around 7:40–7:50 PM)');
    expect(html).toContain('₹30');
    expect(html).toContain('Pay ₹330 in cash when your food arrives.');
  });

  it('OD2: no "Need help?" when no help number is set', () => {
    const html = details({ ...BATCH, contactPhone: null }, true);
    expect(html).not.toContain('Need help?');
    expect(html).not.toContain('tel:');
  });

  it('OD3: a later visit shows "ORDER BB1023" and a status chip; the big ID block is not repeated', () => {
    const received = details(BATCH, false);
    expect(received).toContain('ORDER BB1023');
    expect(received).toContain('Order received');
    expect(received).not.toContain('ORDER PLACED');
    const completed = details({ ...BATCH, status: 'COMPLETED' }, false);
    expect(completed).toContain('ORDER BB1023');
    expect(completed).toContain('Completed');
  });

  it('OD3: a placed order whose status has moved on drops the "just placed" heading', () => {
    expect(details({ ...BATCH, status: 'COMPLETED' }, true)).not.toContain('ORDER PLACED');
  });

  it('OD3: a cancelled order is a danger alert with the contact number, and no payment ask', () => {
    const html = details({ ...BATCH, status: 'CANCELLED' }, false);
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain(
      'This order was cancelled. Contact Bunty Biryani Centre if you have questions.',
    );
    expect(html).toContain('tel:9876543210');
    expect(html).not.toContain('Pay ₹300 in cash');
    expect(html).not.toContain('Order received');
  });

  it('OD3: collected cash reads "Cash on delivery · Collected", and nothing says "Paid"', () => {
    const collected = details({ ...BATCH, status: 'COMPLETED', paymentStatus: 'COLLECTED' }, false);
    expect(collected).toContain('Cash on delivery · Collected');
    expect(collected).not.toContain('Payment: CASH ON DELIVERY');
    expect(collected).not.toContain('Pay ₹300 in cash');
    for (const order of [
      BATCH,
      EXPRESS,
      { ...BATCH, status: 'COMPLETED' as const },
      { ...BATCH, status: 'CANCELLED' as const },
      { ...BATCH, status: 'COMPLETED' as const, paymentStatus: 'COLLECTED' as const },
    ]) {
      for (const placed of [true, false]) {
        expect(details(order, placed)).not.toMatch(/\bpaid\b/i);
      }
    }
  });
});

interface Setup {
  state?: unknown;
  local?: Record<string, string>;
  path?: string;
}

function renderOrderPage({ state, local = {}, path = '/order/BB1023' }: Setup = {}): string {
  const value = { provider: () => new Map(), fallback: { [MENU_KEY]: MENU } };
  const routes = h(Routes, null, h(Route, { path: '/order/:orderNumber', element: h(OrderPage) }));
  return withWindowStorage({ local }, () =>
    render(h(SWRConfig, { value }, h(CartProvider, null, routes)), [{ pathname: path, state }]),
  );
}

describe('OrderPage', () => {
  it('OP1: router state from the submit renders the details with no request', () => {
    const html = renderOrderPage({ state: { order: BATCH, phone: '9123456780', placed: true } });
    expect(html).toContain('ORDER PLACED');
    expect(html).toContain('BB1023');
    expect(html).toContain('Batch · MSH');
    expect(html).toContain('Today, 8:00 PM');
    expect(html).not.toContain('Find order');
  });

  it('OP2: with no state and nothing stored, it shows the track form with the ID filled in', () => {
    const html = renderOrderPage();
    expect(html).toContain('value="BB1023"');
    expect(html).toContain('Find order');
    expect(html).not.toContain('ORDER PLACED');
  });

  it('OP2: foreign router state is ignored the same way', () => {
    const html = renderOrderPage({
      state: { order: { ...BATCH, orderNumber: 'BB1002' }, phone: '9123456780', placed: true },
    });
    expect(html).toContain('value="BB1023"');
    expect(html).not.toContain('ORDER PLACED');
  });

  it('OP2: an invalid order number in the URL shows an empty track form', () => {
    const html = renderOrderPage({ path: '/order/oops' });
    expect(html).toContain('Find order');
    expect(html).not.toContain('value="BB');
  });

  it('OP2: a stored phone starts a lookup, so the page shows a skeleton, not the form', () => {
    const entry = { orderNumber: 'BB1023', phone: '9123456780', deliveryDate: TODAY };
    const html = renderOrderPage({ local: { [RECENT_ORDERS_KEY]: JSON.stringify([entry]) } });
    expect(html).not.toContain('Find order');
    expect(html).toContain('aria-busy="true"');
  });
});

describe('TrackPage', () => {
  const renderTrack = (local: Record<string, string> = {}) =>
    withWindowStorage({ local }, () => render(h(TrackPage)));

  it('TP1: lists the orders on this phone, newest first', () => {
    const list = [
      { orderNumber: 'BB1023', phone: '9123456780', deliveryDate: '2026-10-04' },
      { orderNumber: 'BB1019', phone: '9123456780', deliveryDate: '2026-10-03' },
    ];
    const html = renderTrack({ [RECENT_ORDERS_KEY]: JSON.stringify(list) });
    expect(html).toContain('Orders on this phone');
    expect(html).toContain('BB1023 · Sun, 4 Oct');
    expect(html).toContain('BB1019 · Sat, 3 Oct');
    expect(html.indexOf('BB1023 · Sun, 4 Oct')).toBeLessThan(html.indexOf('BB1019 · Sat, 3 Oct'));
    expect(html).toContain('href="/order/BB1023"');
  });

  it('TP1: with nothing stored there is no list heading', () => {
    expect(renderTrack()).not.toContain('Orders on this phone');
  });

  it('TP1: the form has the brief field attributes', () => {
    const html = renderTrack();
    expect(html).toContain('placeholder="BB1023"');
    expect(html).toContain('autoCapitalize="characters"');
    expect(html).toContain('spellCheck="false"');
    expect(html).toContain('type="tel"');
    expect(html).toContain('autoComplete="tel-national"');
    expect(html).toContain('Mobile number');
    expect(html).toContain('Find order');
  });
});

describe('RouteErrorBoundary', () => {
  // renderToStaticMarkup can't run error boundaries (a throwing child just throws), so the
  // fallback view is rendered directly and the boundary's state hook is checked on its own.
  it('RB1: the load-failure view has the title, the message and a retry button', () => {
    const html = render(h(RouteLoadError));
    expect(html).toContain(escaped("Couldn't load this page."));
    expect(html).toContain('Check your connection and try again.');
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('<header');
  });

  it('RB1: a route without its own header gets the customer chrome around it', () => {
    const html = render(h(RouteLoadError, { withChrome: true }));
    expect(html).toContain('<header');
    expect(html).toContain('Bunty Biryani Centre');
    expect(html).toContain('Try again');
  });

  it('RB2: a render error flips the boundary to its fallback, and healthy children pass through', () => {
    expect(RouteErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    expect(render(h(RouteErrorBoundary, null, h('p', null, 'fine')))).toBe('<p>fine</p>');
    const broken = new RouteErrorBoundary({ children: null, withChrome: true });
    broken.state = RouteErrorBoundary.getDerivedStateFromError();
    expect(render(broken.render() as ReactElement)).toContain('Try again');
  });
});
