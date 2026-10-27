import type { AdminLocation, AdminSettings, AdminSlot } from '@shared/api-types.js';
import { describe, expect, it } from 'vitest';
import {
  deactivateWarning,
  etaPreview,
  settingsFormToPatch,
  slotEditWarning,
  slotLine,
  slotsByLocation,
} from '../../src/client/features/admin/delivery/settings-logic.js';

describe('Admin settings logic (ST1-ST3)', () => {
  it('ST1: etaPreview gives exact string for valid inputs and null for invalid', () => {
    expect(etaPreview('30', '40')).toBe(
      'Customers see: Delivered in approximately 30–40 minutes',
    );
    expect(etaPreview('abc', '40')).toBeNull();
    expect(etaPreview('30', 'xyz')).toBeNull();
    expect(etaPreview('-5', '40')).toBeNull();
    expect(etaPreview('50', '30')).toBeNull();
    expect(etaPreview('', '40')).toBeNull();
    expect(etaPreview('0', '40')).toBeNull();
  });

  it('ST2: slotLine, deactivateWarning, and slotEditWarning copy matches spec §7.8 exactly', () => {
    const slot: AdminSlot = {
      id: 1,
      locationId: 10,
      locationName: 'MSH',
      deliveryTime: '20:00',
      cutoffTime: '19:30',
      isActive: true,
      closedToday: false,
      openOrdersToday: 3,
    };

    expect(slotLine(slot)).toBe('8:00 PM · order by 7:30 PM');

    const locMsh: AdminLocation = {
      id: 10,
      name: 'MSH',
      isActive: true,
      sortOrder: 1,
      slotCount: 1,
    };
    expect(deactivateWarning(locMsh)).toBe(
      "MSH has 1 active slot. Customers won't see it while MSH is off.",
    );

    const locNoSlots: AdminLocation = {
      id: 20,
      name: 'Kanhar',
      isActive: true,
      sortOrder: 2,
      slotCount: 0,
    };
    expect(deactivateWarning(locNoSlots)).toBeNull();

    const locMultiSlots: AdminLocation = {
      id: 30,
      name: 'Hostel A',
      isActive: true,
      sortOrder: 3,
      slotCount: 2,
    };
    expect(deactivateWarning(locMultiSlots)).toBe(
      "Hostel A has 2 active slots. Customers won't see them while Hostel A is off.",
    );

    expect(slotEditWarning(slot)).toBe(
      '3 customers were told 8:00 PM. The new time applies to new orders only.',
    );

    expect(slotEditWarning({ ...slot, openOrdersToday: 0 })).toBeNull();
    expect(slotEditWarning({ ...slot, openOrdersToday: 1 })).toBe(
      '1 customer was told 8:00 PM. The new time applies to new orders only.',
    );
  });

  it('ST3: settingsFormToPatch sends only changed keys and an empty phone becomes null', () => {
    const current: AdminSettings = {
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

    expect(settingsFormToPatch({ batchFee: 20 }, current)).toEqual({
      batchFee: 20,
    });

    expect(settingsFormToPatch({ contactPhone: '' }, current)).toEqual({
      contactPhone: null,
    });

    expect(settingsFormToPatch({ contactPhone: '   ' }, current)).toEqual({
      contactPhone: null,
    });

    expect(settingsFormToPatch({}, current)).toEqual({});

    // When phone is already null and empty string passed, it is unchanged so not sent
    const currentNoPhone: AdminSettings = { ...current, contactPhone: null };
    expect(settingsFormToPatch({ contactPhone: '' }, currentNoPhone)).toEqual({});

    // Sending multiple changes
    expect(
      settingsFormToPatch(
        {
          expressFee: 40,
          expressOpensAt: '17:00',
          contactPhone: '9999988888',
        },
        current,
      ),
    ).toEqual({
      expressFee: 40,
      expressOpensAt: '17:00',
      contactPhone: '9999988888',
    });
  });

  it('groups slots by location preserving location order', () => {
    const locations: AdminLocation[] = [
      { id: 10, name: 'MSH', isActive: true, sortOrder: 1, slotCount: 1 },
      { id: 20, name: 'Kanhar', isActive: true, sortOrder: 2, slotCount: 1 },
    ];
    const slots: AdminSlot[] = [
      {
        id: 2,
        locationId: 20,
        locationName: 'Kanhar',
        deliveryTime: '20:45',
        cutoffTime: '20:15',
        isActive: true,
        closedToday: false,
        openOrdersToday: 0,
      },
      {
        id: 1,
        locationId: 10,
        locationName: 'MSH',
        deliveryTime: '20:00',
        cutoffTime: '19:30',
        isActive: true,
        closedToday: false,
        openOrdersToday: 0,
      },
    ];

    const grouped = slotsByLocation(slots, locations);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]!.location.name).toBe('MSH');
    expect(grouped[0]!.slots).toHaveLength(1);
    expect(grouped[0]!.slots[0]!.id).toBe(1);
    expect(grouped[1]!.location.name).toBe('Kanhar');
    expect(grouped[1]!.slots).toHaveLength(1);
    expect(grouped[1]!.slots[0]!.id).toBe(2);
  });
});
