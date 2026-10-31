import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SWRConfig } from 'swr';
import { describe, expect, it } from 'vitest';
import { Chip } from '../../src/client/components/Chip';
import { ConfirmDialog } from '../../src/client/components/ConfirmDialog';
import { OverflowMenu } from '../../src/client/components/OverflowMenu';
import { Switch } from '../../src/client/components/Switch';
import { dashboardKey, ordersKey } from '../../src/client/features/admin/api/keys';
import { AdminShell } from '../../src/client/features/admin/layout/AdminShell';
import type { Dashboard } from '../../src/shared/api-types';
import { render } from '../helpers/markup';

describe('Admin components & shell (CM1-CM6)', () => {
  it('CM1: Switch renders role="switch", aria-checked="true" and the visible label', () => {
    const html = renderToStaticMarkup(
      h(Switch, { checked: true, onChange: () => {}, label: 'Pause Orders' }),
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('Pause Orders');
  });

  it('CM2: Chip tone="danger" includes an icon svg', () => {
    const html = renderToStaticMarkup(h(Chip, { tone: 'danger' }, 'Cancelled'));
    expect(html).toContain('<svg');
    expect(html).toContain('Cancelled');
  });

  it('CM3: ConfirmDialog renders a <dialog> with both buttons and danger tone uses danger variant', () => {
    const html = renderToStaticMarkup(
      h(ConfirmDialog, {
        open: true,
        title: 'Discard changes?',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        tone: 'danger',
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    expect(html).toContain('<dialog');
    expect(html).toContain('Discard');
    expect(html).toContain('Keep editing');
    expect(html).toContain('bg-danger');
  });

  it('CM4: OverflowMenu renders a button with popovertarget matching the popover id', () => {
    const html = render(
      h(OverflowMenu, {
        label: 'More options',
        items: [{ label: 'Log out', onSelect: () => {}, tone: 'danger' }],
      }),
    );
    const targetMatch = /popovertarget="([^"]+)"/i.exec(html);
    expect(targetMatch).not.toBeNull();
    const id = targetMatch?.[1];
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain('Log out');
  });

  it('CM5: AdminShell rendered at /admin/stock with paused dashboard shows active tab, paused banner, and links', () => {
    const pausedDashboard: Dashboard = {
      date: '2026-10-04',
      isToday: true,
      serverTime: '12:00',
      controls: {
        ordersPaused: true,
        expressEnabled: true,
        expressAvailableNow: true,
        expressOpensAt: '11:00',
        expressClosesAt: '23:00',
      },
      stock: {
        itemsOnMenu: 5,
        itemsWithoutStockToday: 0,
      },
      summary: {
        newOrders: 0,
        completed: 0,
        cancelled: 0,
        codPending: 0,
        codCollected: 0,
        openOrdersFromEarlierDays: 0,
      },
      earlierOpenOrders: [],
      batches: [],
      express: {
        activeCount: 0,
        orders: [],
      },
    };
    const value = {
      fallback: {
        '/api/admin/dashboard': pausedDashboard,
      },
    };
    const html = render(
      h(SWRConfig, { value }, h(AdminShell)),
      ['/admin/stock'],
    );
    // the Stock tab has aria-current="page"
    expect(html).toMatch(
      /<a\b[^>]*\bhref="\/admin\/stock"[^>]*\baria-current="page"|<a\b[^>]*\baria-current="page"[^>]*\bhref="\/admin\/stock"/,
    );
    // "Orders are paused" shows
    expect(html).toContain('Orders are paused');
    // there are 4 tab links
    expect(html).toContain('href="/admin"');
    expect(html).toContain('href="/admin/stock"');
    expect(html).toContain('href="/admin/menu"');
    expect(html).toContain('href="/admin/delivery"');
    // there's a link to /admin/orders
    expect(html).toContain('href="/admin/orders"');
  });

  it('CM6: dashboardKey and ordersKey produce stable, encoded strings', () => {
    expect(dashboardKey('2026-10-03')).toBe('/api/admin/dashboard?date=2026-10-03');
    expect(dashboardKey()).toBe('/api/admin/dashboard');
    expect(dashboardKey(null)).toBe('/api/admin/dashboard');

    const key1 = ordersKey({ status: 'ORDER_RECEIVED', q: 'biryani & roti' });
    const key2 = ordersKey({ q: 'biryani & roti', status: 'ORDER_RECEIVED' });
    expect(key1).toBe(key2);
    expect(key1).toContain('status=ORDER_RECEIVED');
    expect(key1).toContain('q=biryani+%26+roti');
  });
});
