import type {
  AdminLocation,
  AdminSettings,
  AdminSlot,
} from '@shared/api-types.js';
import { createElement as h } from 'react';
import { SWRConfig } from 'swr';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_LOCATIONS_KEY,
  ADMIN_SETTINGS_KEY,
  ADMIN_SLOTS_KEY,
  dashboardKey,
} from '../../src/client/features/admin/api/keys.js';
import { SettingsPage } from '../../src/client/features/admin/delivery/SettingsPage.js';
import { dashboardFixture } from '../helpers/admin-dashboard-fixture.js';
import { render } from '../helpers/markup.js';

describe('Admin settings screen markup (SS1)', () => {
  it('SS1: the markup shows all eight section headings, time inputs have step="60", and slot lines are grouped under MSH and Kanhar', () => {
    const settings: AdminSettings = {
      ordersPaused: false,
      expressEnabled: true,
      expressFee: 30,
      batchFee: 0,
      expressEtaMinMinutes: 30,
      expressEtaMaxMinutes: 40,
      expressOpensAt: '18:00',
      expressClosesAt: '22:00',
      contactPhone: '9876543210',
    };

    const loc1: AdminLocation = {
      id: 1,
      name: 'MSH',
      isActive: true,
      sortOrder: 0,
      slotCount: 1,
    };

    const loc2: AdminLocation = {
      id: 2,
      name: 'Kanhar',
      isActive: true,
      sortOrder: 1,
      slotCount: 1,
    };

    const slot1: AdminSlot = {
      id: 10,
      locationId: 1,
      locationName: 'MSH',
      deliveryTime: '20:00',
      cutoffTime: '19:30',
      isActive: true,
      closedToday: false,
      openOrdersToday: 0,
    };

    const slot2: AdminSlot = {
      id: 20,
      locationId: 2,
      locationName: 'Kanhar',
      deliveryTime: '20:45',
      cutoffTime: '20:15',
      isActive: true,
      closedToday: false,
      openOrdersToday: 0,
    };

    const value = {
      fallback: {
        [ADMIN_SETTINGS_KEY]: settings,
        [ADMIN_LOCATIONS_KEY]: { locations: [loc1, loc2] },
        [ADMIN_SLOTS_KEY]: { slots: [slot1, slot2] },
        [dashboardKey()]: dashboardFixture,
        '/api/admin/dashboard': dashboardFixture,
      },
    };

    const html = render(
      h(SWRConfig, { value }, h(SettingsPage)),
      ['/admin/delivery'],
    );

    // 1. All eight section headings
    const headings = [
      'Ordering',
      'Express',
      'Batch',
      'Locations',
      'Batch slots',
      'Customer help number',
      'This device',
      'Account',
    ];

    for (const heading of headings) {
      expect(html).toContain(heading);
    }

    // 2. Time inputs have step="60"
    expect(html).toContain('step="60"');

    // 3. Slot lines are grouped under MSH and Kanhar
    const batchSlotsHtml = html.slice(html.indexOf('Batch slots'));
    const idxMsh = batchSlotsHtml.indexOf('MSH');
    const idxSlot1 = batchSlotsHtml.indexOf('8:00 PM · order by 7:30 PM');
    const idxKanhar = batchSlotsHtml.indexOf('Kanhar');
    const idxSlot2 = batchSlotsHtml.indexOf('8:45 PM · order by 8:15 PM');

    expect(idxMsh).toBeGreaterThanOrEqual(0);
    expect(idxSlot1).toBeGreaterThan(idxMsh);
    expect(idxKanhar).toBeGreaterThan(idxSlot1);
    expect(idxSlot2).toBeGreaterThan(idxKanhar);
  });
});
