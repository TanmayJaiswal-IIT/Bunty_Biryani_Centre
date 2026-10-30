import { createElement as h } from 'react';
import { SWRConfig } from 'swr';
import { describe, expect, it } from 'vitest';
import type { AdminOrderView } from '../../src/shared/api-types';
import { dashboardKey } from '../../src/client/features/admin/api/keys';
import { OrderRow } from '../../src/client/features/admin/orders/OrderRow';
import { TodayPage } from '../../src/client/features/admin/today/TodayPage';
import { dashboardFixture } from '../helpers/admin-dashboard-fixture';
import { render } from '../helpers/markup';

describe('Admin today screen markup (TD1-TD6)', () => {
  it('TD1: TodayPage renders MSH 8:00 PM, 4 orders, breakdown line, Kanhar empty slot, EXPRESS 2 active, and LATE chip', () => {
    const value = {
      fallback: {
        [dashboardKey()]: dashboardFixture,
      },
    };
    const html = render(h(SWRConfig, { value }, h(TodayPage)), ['/admin']);

    expect(html).toContain('MSH — 8:00 PM');
    expect(html).toContain('4 orders · 9 items · ₹1,340 COD');
    expect(html).toContain('Chicken Biryani ×8 · Paneer Biryani ×1');
    expect(html).toContain('Kanhar — 8:45 PM');
    expect(html).toContain('No orders yet');
    expect(html).toContain('EXPRESS · 2 active');

    // LATE chip with an icon
    expect(html).toContain('LATE');
    expect(html).toMatch(
      /<span[^>]*bg-danger-soft[^>]*>[\s\S]*?<svg[\s\S]*?<\/svg>[\s\S]*?LATE[\s\S]*?<\/span>/,
    );

    // On today, the next arrow › is disabled
    expect(html).toMatch(/<span[^>]*\baria-disabled="true"[^>]*>›<\/span>/);
  });

  it('TD2: paused controls shows aria-checked="false" with "Paused"', () => {
    const pausedDashboard = {
      ...dashboardFixture,
      controls: {
        ...dashboardFixture.controls,
        ordersPaused: true,
      },
    };
    const value = {
      fallback: {
        [dashboardKey()]: pausedDashboard,
      },
    };
    const html = render(h(SWRConfig, { value }, h(TodayPage)), ['/admin']);

    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('Paused');
  });

  it('TD3: ?date= a past day enables next arrow, hides stock banner and close slot', () => {
    const pastDate = '2026-10-03';
    const pastDashboard = {
      ...dashboardFixture,
      date: pastDate,
      isToday: false,
      stock: {
        itemsOnMenu: 3,
        itemsWithoutStockToday: 2,
      },
    };
    const value = {
      fallback: {
        [dashboardKey(pastDate)]: pastDashboard,
      },
    };
    const html = render(
      h(SWRConfig, { value }, h(TodayPage)),
      [`/admin?date=${pastDate}`],
    );

    // Next arrow › is active for navigating back towards today
    expect(html).toContain('aria-label="Next day"');
    // No stock banner
    expect(html).not.toContain('no stock set for today');
    // No Close for today option in batch overflow
    expect(html).not.toContain('Close for today');
  });

  it('TD4: nothing rendered matches /\\bpaid\\b/i, and "COD · Pending" appears', () => {
    const value = {
      fallback: {
        [dashboardKey()]: dashboardFixture,
      },
    };
    const html = render(h(SWRConfig, { value }, h(TodayPage)), ['/admin']);

    expect(html).not.toMatch(/\bpaid\b/i);
    expect(html).toContain('COD · Pending');
  });

  it('TD5: the stale strip (cache seeded with data + error) shows "Showing orders from 7:12 PM"', () => {
    const cache = new Map();
    cache.set(dashboardKey(), {
      data: {
        ...dashboardFixture,
        serverTime: '19:12',
      },
      error: new Error('Network timeout'),
    });

    const value = {
      provider: () => cache,
    };
    const html = render(h(SWRConfig, { value }, h(TodayPage)), ['/admin']);

    expect(html).toContain('Showing orders from 7:12 PM');
  });

  it('TD6: an OrderRow with collected cash disables the Cancel item and shows the hint', () => {
    const collectedOrder: AdminOrderView = {
      ...dashboardFixture.batches[0]!.orders[1]!,
      status: 'ORDER_RECEIVED',
      paymentStatus: 'COLLECTED',
    };

    const html = render(
      h(OrderRow, { order: collectedOrder, isToday: true }),
      ['/admin'],
    );

    // Cancel order is disabled and shows hint
    expect(html).toMatch(
      /<button[^>]*\bdisabled[^>]*>[\s\S]*?Cancel order[\s\S]*?Undo cash collected first\.[\s\S]*?<\/button>/,
    );
  });
});
