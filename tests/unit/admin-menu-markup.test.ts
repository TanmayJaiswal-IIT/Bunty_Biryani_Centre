import { createElement as h } from 'react';
import { Route, Routes } from 'react-router';
import { SWRConfig } from 'swr';
import { describe, expect, it } from 'vitest';
import type { AdminMenuItem } from '../../src/shared/api-types';
import { ADMIN_MENU_KEY } from '../../src/client/features/admin/api/keys';
import { MenuItemForm } from '../../src/client/features/admin/menu/MenuItemForm';
import { MenuPage } from '../../src/client/features/admin/menu/MenuPage';
import { render } from '../helpers/markup';

describe('Admin menu screen markup (MM1-MM2)', () => {
  const item: AdminMenuItem = {
    id: 1,
    name: 'Chicken Biryani',
    description: 'Fragrant basmati rice with spiced chicken',
    price: 150,
    imageUrl: 'https://example.com/chicken.jpg',
    isAvailable: true,
    sortOrder: 0,
    dailyStock: 20,
    stockRemaining: 15,
    stockDate: '2026-10-04',
    stockSetToday: true,
    soldToday: 5,
  };

  it('MM1: the list markup has the switch and the move buttons with labels', () => {
    const value = {
      fallback: {
        [ADMIN_MENU_KEY]: { items: [item] },
      },
    };

    const html = render(h(SWRConfig, { value }, h(MenuPage)), ['/admin/menu']);

    expect(html).toContain('Chicken Biryani');
    expect(html).toContain('₹150');
    // On menu Switch
    expect(html).toContain('role="switch"');
    expect(html).toContain('On menu');
    // Move buttons with aria-label
    expect(html).toContain('aria-label="Move Chicken Biryani up"');
    expect(html).toContain('aria-label="Move Chicken Biryani down"');
  });

  it('MM2: the edit form shows the price note and Delete; the new-item form does not', () => {
    const value = {
      fallback: {
        [ADMIN_MENU_KEY]: { items: [item] },
      },
    };

    // Edit form (/admin/menu/1)
    const editElement = h(
      SWRConfig,
      { value },
      h(
        Routes,
        null,
        h(Route, { path: '/admin/menu/:id', element: h(MenuItemForm) }),
      ),
    );
    const editHtml = render(editElement, ['/admin/menu/1']);

    expect(editHtml).toContain('New prices apply to new orders only.');
    expect(editHtml).toContain('Delete item');

    // New item form (/admin/menu/new)
    const newElement = h(
      SWRConfig,
      { value },
      h(
        Routes,
        null,
        h(Route, { path: '/admin/menu/new', element: h(MenuItemForm) }),
      ),
    );
    const newHtml = render(newElement, ['/admin/menu/new']);

    expect(newHtml).not.toContain('New prices apply to new orders only.');
    expect(newHtml).not.toContain('Delete item');
  });
});
