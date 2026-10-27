import { createElement as h } from 'react';
import { SWRConfig } from 'swr';
import { describe, expect, it } from 'vitest';
import type { AdminMenuItem } from '../../src/shared/api-types';
import { ADMIN_MENU_KEY, dashboardKey } from '../../src/client/features/admin/api/keys';
import { StockPage } from '../../src/client/features/admin/stock/StockPage';
import { dashboardFixture } from '../helpers/admin-dashboard-fixture';
import { escaped, render } from '../helpers/markup';

describe('Admin stock screen markup (SM1)', () => {
  it('SM1: markup shows "Hidden from menu" after available items, "last: 20" and labelled inputs', () => {
    const item1: AdminMenuItem = {
      id: 1,
      name: 'Chicken Biryani',
      description: null,
      price: 150,
      imageUrl: null,
      isAvailable: true,
      sortOrder: 0,
      dailyStock: 30,
      stockRemaining: 25,
      stockDate: '2026-10-04',
      stockSetToday: true,
      soldToday: 5,
    };

    const item2: AdminMenuItem = {
      id: 2,
      name: 'Paneer Biryani',
      description: null,
      price: 140,
      imageUrl: null,
      isAvailable: false,
      sortOrder: 1,
      dailyStock: 20,
      stockRemaining: 0,
      stockDate: '2026-10-03',
      stockSetToday: false,
      soldToday: 0,
    };

    const value = {
      fallback: {
        [ADMIN_MENU_KEY]: { items: [item1, item2] },
        [dashboardKey()]: dashboardFixture,
        '/api/admin/dashboard': dashboardFixture,
      },
    };

    const html = render(h(SWRConfig, { value }, h(StockPage)), ['/admin/stock']);

    // Title includes date from dashboard
    expect(html).toContain(escaped("TODAY'S STOCK · Sun, 4 Oct"));

    // Hidden from menu heading appears after available item and before hidden item
    const idxItem1 = html.indexOf('Chicken Biryani');
    const idxHeading = html.indexOf('Hidden from menu');
    const idxItem2 = html.indexOf('Paneer Biryani');

    expect(idxItem1).toBeGreaterThanOrEqual(0);
    expect(idxHeading).toBeGreaterThan(idxItem1);
    expect(idxItem2).toBeGreaterThan(idxHeading);

    // "last: 20" appears for item2
    expect(html).toContain('last: 20');

    // Labelled inputs
    expect(html).toContain('Total for today');
    expect(html).toContain('id="stock-input-1"');
    expect(html).toContain('id="stock-input-2"');
  });
});
