import type {
  AdminLocation,
  AdminSettings,
  AdminSlot,
  SettingsUpdateInput,
} from '@shared/api-types.js';
import { formatTime12h } from '@shared/time.js';

export interface SettingsForm {
  ordersPaused?: boolean;
  expressEnabled?: boolean;
  expressFee?: string | number;
  batchFee?: string | number;
  expressEtaMinMinutes?: string | number;
  expressEtaMaxMinutes?: string | number;
  expressOpensAt?: string;
  expressClosesAt?: string;
  contactPhone?: string | null;
}

/**
 * 'Customers see: Delivered in approximately 30–40 minutes'
 * Returns null if min or max is not a positive integer string or if min > max.
 */
export function etaPreview(min: string, max: string): string | null {
  const minTrim = min.trim();
  const maxTrim = max.trim();
  if (!/^\d+$/.test(minTrim) || !/^\d+$/.test(maxTrim)) {
    return null;
  }
  const minVal = parseInt(minTrim, 10);
  const maxVal = parseInt(maxTrim, 10);
  if (minVal <= 0 || maxVal <= 0 || minVal > maxVal) {
    return null;
  }
  return `Customers see: Delivered in approximately ${minVal}–${maxVal} minutes`;
}

/**
 * Formats a slot's delivery and cutoff times:
 * '8:00 PM · order by 7:30 PM'
 */
export function slotLine(s: AdminSlot): string {
  return `${formatTime12h(s.deliveryTime)} · order by ${formatTime12h(s.cutoffTime)}`;
}

/**
 * Groups slots by location, preserving the order of locations.
 */
export function slotsByLocation(
  slots: AdminSlot[],
  locations: AdminLocation[],
): Array<{ location: AdminLocation; slots: AdminSlot[] }> {
  return locations.map((loc) => ({
    location: loc,
    slots: slots
      .filter((s) => s.locationId === loc.id)
      .sort((a, b) => a.deliveryTime.localeCompare(b.deliveryTime)),
  }));
}

/**
 * Spec §7.8: "MSH has 1 active slot. Customers won't see it while MSH is off."
 * Returns null if the location has 0 active slots.
 */
export function deactivateWarning(
  l: AdminLocation,
  activeSlotCount?: number,
): string | null {
  const count = activeSlotCount !== undefined ? activeSlotCount : l.slotCount;
  if (count <= 0) return null;
  if (count === 1) {
    return `${l.name} has 1 active slot. Customers won't see it while ${l.name} is off.`;
  }
  return `${l.name} has ${count} active slots. Customers won't see them while ${l.name} is off.`;
}

/**
 * Spec §7.8: "3 customers were told 8:00 PM. The new time applies to new orders only."
 * Returns null if openOrdersToday is 0 or unset.
 */
export function slotEditWarning(s: AdminSlot): string | null {
  if (!s.openOrdersToday || s.openOrdersToday <= 0) return null;
  const time = formatTime12h(s.deliveryTime);
  if (s.openOrdersToday === 1) {
    return `1 customer was told ${time}. The new time applies to new orders only.`;
  }
  return `${s.openOrdersToday} customers were told ${time}. The new time applies to new orders only.`;
}

/**
 * Compares the form with current AdminSettings and returns a patch containing ONLY changed keys.
 * An empty or whitespace phone string becomes null.
 */
export function settingsFormToPatch(
  form: SettingsForm,
  current: AdminSettings,
): SettingsUpdateInput {
  const patch: SettingsUpdateInput = {};

  if (
    form.ordersPaused !== undefined &&
    form.ordersPaused !== current.ordersPaused
  ) {
    patch.ordersPaused = form.ordersPaused;
  }

  if (
    form.expressEnabled !== undefined &&
    form.expressEnabled !== current.expressEnabled
  ) {
    patch.expressEnabled = form.expressEnabled;
  }

  if (form.expressFee !== undefined) {
    const val =
      typeof form.expressFee === 'string'
        ? Number(form.expressFee)
        : form.expressFee;
    if (!isNaN(val) && val !== current.expressFee) {
      patch.expressFee = val;
    }
  }

  if (form.batchFee !== undefined) {
    const val =
      typeof form.batchFee === 'string'
        ? Number(form.batchFee)
        : form.batchFee;
    if (!isNaN(val) && val !== current.batchFee) {
      patch.batchFee = val;
    }
  }

  if (form.expressEtaMinMinutes !== undefined) {
    const val =
      typeof form.expressEtaMinMinutes === 'string'
        ? Number(form.expressEtaMinMinutes)
        : form.expressEtaMinMinutes;
    if (!isNaN(val) && val !== current.expressEtaMinMinutes) {
      patch.expressEtaMinMinutes = val;
    }
  }

  if (form.expressEtaMaxMinutes !== undefined) {
    const val =
      typeof form.expressEtaMaxMinutes === 'string'
        ? Number(form.expressEtaMaxMinutes)
        : form.expressEtaMaxMinutes;
    if (!isNaN(val) && val !== current.expressEtaMaxMinutes) {
      patch.expressEtaMaxMinutes = val;
    }
  }

  if (
    form.expressOpensAt !== undefined &&
    form.expressOpensAt !== current.expressOpensAt
  ) {
    patch.expressOpensAt = form.expressOpensAt;
  }

  if (
    form.expressClosesAt !== undefined &&
    form.expressClosesAt !== current.expressClosesAt
  ) {
    patch.expressClosesAt = form.expressClosesAt;
  }

  if (form.contactPhone !== undefined) {
    const normalized = form.contactPhone?.trim() || null;
    if (normalized !== current.contactPhone) {
      patch.contactPhone = normalized;
    }
  }

  return patch;
}
