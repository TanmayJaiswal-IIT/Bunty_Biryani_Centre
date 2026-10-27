import { describe, expect, it } from 'vitest';
import {
  breakdownLine,
  countLine,
  dateHref,
  expressSubtext,
  openIds,
  shiftDate,
  slotChip,
} from '../../src/client/features/admin/today/today-logic';
import {
  cancelDialogText,
  codLabel,
  expressWhen,
  formatInstant,
  itemsInline,
} from '../../src/client/features/admin/orders/order-display';
import { dashboardFixture } from '../helpers/admin-dashboard-fixture';

describe('Admin today logic (TL1-TL5)', () => {
  it('TL1: shiftDate shifts dates across months and years, and dateHref generates correct paths', () => {
    expect(shiftDate('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDate('2026-02-28', 1)).toBe('2026-03-01');

    expect(dateHref('2026-10-04', dashboardFixture)).toBe('/admin');
    expect(dateHref('2026-10-03', dashboardFixture)).toBe('/admin?date=2026-10-03');
  });

  it('TL2: expressSubtext covers all three states', () => {
    expect(
      expressSubtext(
        {
          ordersPaused: false,
          expressEnabled: false,
          expressAvailableNow: false,
          expressOpensAt: '11:00',
          expressClosesAt: '23:00',
        },
        '12:00',
      ),
    ).toBe('Off');

    expect(
      expressSubtext(
        {
          ordersPaused: false,
          expressEnabled: true,
          expressAvailableNow: true,
          expressOpensAt: '11:00',
          expressClosesAt: '23:00',
        },
        '12:00',
      ),
    ).toBe('On · till 11:00 PM');

    expect(
      expressSubtext(
        {
          ordersPaused: false,
          expressEnabled: true,
          expressAvailableNow: false,
          expressOpensAt: '11:00',
          expressClosesAt: '23:00',
        },
        '09:00',
      ),
    ).toBe('On · opens 11:00 AM');
  });

  it('TL3: slotChip covers all four cases', () => {
    const batch = dashboardFixture.batches[0]!;
    // Past date -> null
    expect(slotChip(batch, false)).toBeNull();

    // Closed today -> warning
    expect(slotChip({ ...batch, closedToday: true }, true)).toEqual({
      tone: 'warning',
      text: 'Closed today',
    });

    // Open now -> success
    expect(slotChip({ ...batch, closedToday: false, isOpenNow: true }, true)).toEqual({
      tone: 'success',
      text: 'Open till 7:30 PM',
    });

    // Closed for orders -> neutral
    expect(slotChip({ ...batch, closedToday: false, isOpenNow: false }, true)).toEqual({
      tone: 'neutral',
      text: 'Closed for orders',
    });
  });

  it('TL4: countLine and breakdownLine match fixture expectations', () => {
    const batch = dashboardFixture.batches[0]!;
    expect(countLine(batch)).toBe('4 orders · 9 items · ₹1,340 COD');
    expect(breakdownLine(batch)).toBe('Chicken Biryani ×8 · Paneer Biryani ×1');
    expect(openIds(batch)).toEqual([102, 103, 104]);
  });

  it('TL5: codLabel, expressWhen, formatInstant, itemsInline and cancelDialogText', () => {
    const completedOrder = dashboardFixture.batches[0]!.orders[0]!;
    const openOrder = dashboardFixture.batches[0]!.orders[1]!;
    const expressOrder = dashboardFixture.express.orders[0]!;

    expect(codLabel(completedOrder)).toBe('COD · Collected');
    expect(codLabel(openOrder)).toBe('COD · Pending');

    expect(expressWhen(expressOrder)).toBe(
      'Ordered 7:10 PM · deliver approx. 7:40–7:50 PM',
    );
    expect(formatInstant('2026-10-04T13:40:00.000Z')).toBe('Sun, 4 Oct, 7:10 PM');
    expect(itemsInline(completedOrder)).toBe('Chicken Biryani ×2');

    expect(cancelDialogText(completedOrder, true)).toContain(
      "food will return to today's available stock",
    );
    expect(cancelDialogText(completedOrder, false)).toContain(
      'earlier day, so stock will not be affected',
    );
  });
});
