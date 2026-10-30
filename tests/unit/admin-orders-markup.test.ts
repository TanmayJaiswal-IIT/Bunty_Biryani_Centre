import { createElement as h } from 'react';
import { Route, Routes } from 'react-router';
import { SWRConfig } from 'swr';
import { describe, expect, it } from 'vitest';
import type { AdminOrderView } from '../../src/shared/api-types';
import { orderKey, ordersKey } from '../../src/client/features/admin/api/keys';
import { OrderDetailPage } from '../../src/client/features/admin/orders/OrderDetailPage';
import { OrdersPage } from '../../src/client/features/admin/orders/OrdersPage';
import { dashboardFixture } from '../helpers/admin-dashboard-fixture';
import { render } from '../helpers/markup';

describe('Admin orders search and detail markup (OR1-OR4)', () => {
  it('OR1: the results list renders BB1001 and the item line', () => {
    const order = dashboardFixture.batches[0]!.orders[0]!;
    const value = {
      fallback: {
        [ordersKey({ date: '2026-10-04' })]: { orders: [order] },
        '/api/admin/dashboard': dashboardFixture,
      },
    };

    const html = render(h(SWRConfig, { value }, h(OrdersPage)), ['/admin/orders']);

    expect(html).toContain('BB1001');
    expect(html).toContain('Chicken Biryani ×2');
  });

  it('OR2: the empty state renders "No orders match."', () => {
    const value = {
      fallback: {
        [ordersKey({ date: '2026-10-04' })]: { orders: [] },
        '/api/admin/dashboard': dashboardFixture,
      },
    };

    const html = render(h(SWRConfig, { value }, h(OrdersPage)), ['/admin/orders']);

    expect(html).toContain('No orders match.');
  });

  it('OR3: the detail page for an express order shows window and "COD · Collected" + "Cash collected at …", never "paid"', () => {
    const baseExpress = dashboardFixture.express.orders[0]!;
    const expressCollected: AdminOrderView = {
      ...baseExpress,
      paymentStatus: 'COLLECTED',
      collectedAt: '2026-10-04T14:30:00.000Z',
    };

    const value = {
      fallback: {
        [orderKey(expressCollected.id)]: expressCollected,
      },
    };

    const element = h(
      SWRConfig,
      { value },
      h(
        Routes,
        null,
        h(Route, { path: '/admin/orders/:id', element: h(OrderDetailPage) }),
      ),
    );

    const html = render(element, [`/admin/orders/${expressCollected.id}`]);

    // Express window
    expect(html).toContain('approx. 7:40–7:50 PM');
    // COD Collected
    expect(html).toContain('COD · Collected');
    // Cash collected timestamp
    expect(html).toContain('Cash collected at Sun, 4 Oct, 8:00 PM');
    // Never "paid"
    expect(html).not.toMatch(/\bpaid\b/i);
  });

  it('OR4: a cancelled order shows the Cancelled chip and no Done or Cash buttons', () => {
    const cancelledOrder: AdminOrderView = {
      ...dashboardFixture.batches[0]!.orders[0]!,
      status: 'CANCELLED',
      cancelledAt: '2026-10-04T15:00:00.000Z',
    };

    const value = {
      fallback: {
        [orderKey(cancelledOrder.id)]: cancelledOrder,
      },
    };

    const element = h(
      SWRConfig,
      { value },
      h(
        Routes,
        null,
        h(Route, { path: '/admin/orders/:id', element: h(OrderDetailPage) }),
      ),
    );

    const html = render(element, [`/admin/orders/${cancelledOrder.id}`]);

    // Cancelled chip is shown
    expect(html).toContain('Cancelled');
    // No Done or Reopen buttons
    expect(html).not.toMatch(/<button[^>]*>[^<]*Done[^<]*<\/button>/);
    expect(html).not.toMatch(/<button[^>]*>[^<]*Reopen[^<]*<\/button>/);
    // No Cash collected or Undo cash buttons
    expect(html).not.toMatch(/<button[^>]*>[^<]*Cash collected[^<]*<\/button>/);
    expect(html).not.toMatch(/<button[^>]*>[^<]*Undo cash[^<]*<\/button>/);
  });
});
