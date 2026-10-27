import type {
  AdminLocation,
  AdminMenuItem,
  AdminMenuResponse,
  AdminOrderView,
  AdminSettings,
  AdminSlot,
  CompleteManyInput,
  CompleteManyResult,
  LocationCreateInput,
  LocationUpdateInput,
  MenuItemCreateInput,
  MenuItemUpdateInput,
  OrderAction,
  SettingsUpdateInput,
  SlotCreateInput,
  SlotUpdateInput,
  StockBulkInput,
} from '@shared/api-types.js';
import type { ScopedMutator } from 'swr';
import { api } from '../../../lib/api';

export function setOrderStatus(
  id: number,
  action: OrderAction,
): Promise<AdminOrderView> {
  return api<AdminOrderView>(`/api/admin/orders/${id}/status`, {
    method: 'PATCH',
    body: action,
  });
}

export function completeOrders(
  body: CompleteManyInput,
): Promise<CompleteManyResult> {
  return api<CompleteManyResult>('/api/admin/orders/complete-many', {
    method: 'POST',
    body,
  });
}

export function patchSettings(
  patch: SettingsUpdateInput,
): Promise<AdminSettings> {
  return api<AdminSettings>('/api/admin/settings', {
    method: 'PATCH',
    body: patch,
  });
}

export function saveStock(body: StockBulkInput): Promise<AdminMenuResponse> {
  return api<AdminMenuResponse>('/api/admin/stock', {
    method: 'PUT',
    body,
  });
}

export function createMenuItem(
  input: MenuItemCreateInput,
): Promise<AdminMenuItem> {
  return api<AdminMenuItem>('/api/admin/menu', {
    method: 'POST',
    body: input,
  });
}

export function updateMenuItem(
  id: number,
  input: MenuItemUpdateInput,
): Promise<AdminMenuItem> {
  return api<AdminMenuItem>(`/api/admin/menu/${id}`, {
    method: 'PATCH',
    body: input,
  });
}

export function deleteMenuItem(id: number): Promise<void> {
  return api<void>(`/api/admin/menu/${id}`, {
    method: 'DELETE',
  });
}

export function createLocation(
  input: LocationCreateInput,
): Promise<AdminLocation> {
  return api<AdminLocation>('/api/admin/locations', {
    method: 'POST',
    body: input,
  });
}

export function updateLocation(
  id: number,
  input: LocationUpdateInput,
): Promise<AdminLocation> {
  return api<AdminLocation>(`/api/admin/locations/${id}`, {
    method: 'PATCH',
    body: input,
  });
}

export function createSlot(input: SlotCreateInput): Promise<AdminSlot> {
  return api<AdminSlot>('/api/admin/delivery-slots', {
    method: 'POST',
    body: input,
  });
}

export function updateSlot(
  id: number,
  input: SlotUpdateInput,
): Promise<AdminSlot> {
  return api<AdminSlot>(`/api/admin/delivery-slots/${id}`, {
    method: 'PATCH',
    body: input,
  });
}

/** Revalidates every key under /api/admin/dashboard and /api/admin/orders (global mutate with a key matcher). */
export function refreshOrders(mutate: ScopedMutator): Promise<unknown> {
  return mutate(
    (key: unknown) =>
      typeof key === 'string' &&
      (key.startsWith('/api/admin/dashboard') ||
        key.startsWith('/api/admin/orders')),
  );
}
