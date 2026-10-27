import type {
  AdminLocationsResponse,
  AdminMenuResponse,
  AdminOrdersResponse,
  AdminOrderView,
  AdminSettings,
  AdminSlotsResponse,
  Dashboard,
  OrdersQueryInput,
} from '@shared/api-types.js';
import useSWR, { type SWRConfiguration, type SWRResponse } from 'swr';
import { api, type ApiError } from '../../../lib/api';
import {
  ADMIN_LOCATIONS_KEY,
  ADMIN_MENU_KEY,
  ADMIN_SETTINGS_KEY,
  ADMIN_SLOTS_KEY,
  dashboardKey,
  orderKey,
  ordersKey,
} from './keys.js';

export type LoadedDashboard = Dashboard & { receivedAt: number };

export async function fetchDashboard(path: string): Promise<LoadedDashboard> {
  const d = await api<Dashboard>(path);
  return { ...d, receivedAt: performance.now() };
}

export function dashboardSwrOptions(
  onSuccess?: (d: LoadedDashboard) => void,
): SWRConfiguration<LoadedDashboard, ApiError> {
  return {
    refreshInterval: 20_000,
    revalidateOnFocus: true,
    refreshWhenHidden: false,
    keepPreviousData: true,
    dedupingInterval: 5_000,
    onSuccess,
  };
}

export function useDashboard(
  date?: string | null,
  onSuccess?: (d: LoadedDashboard) => void,
): SWRResponse<LoadedDashboard, ApiError> {
  return useSWR<LoadedDashboard, ApiError>(
    dashboardKey(date),
    fetchDashboard,
    dashboardSwrOptions(onSuccess),
  );
}

export function useAdminOrders(
  params: OrdersQueryInput = {},
): SWRResponse<AdminOrdersResponse, ApiError> {
  return useSWR<AdminOrdersResponse, ApiError>(ordersKey(params), {
    revalidateOnFocus: true,
    keepPreviousData: true,
  });
}

export function useAdminOrder(
  id: number | null,
): SWRResponse<AdminOrderView, ApiError> {
  return useSWR<AdminOrderView, ApiError>(id ? orderKey(id) : null, {
    revalidateOnFocus: true,
  });
}

export function useAdminMenu(): SWRResponse<AdminMenuResponse, ApiError> {
  return useSWR<AdminMenuResponse, ApiError>(ADMIN_MENU_KEY, {
    revalidateOnFocus: true,
  });
}

export function useLocations(): SWRResponse<AdminLocationsResponse, ApiError> {
  return useSWR<AdminLocationsResponse, ApiError>(ADMIN_LOCATIONS_KEY, {
    revalidateOnFocus: true,
  });
}

export function useSlots(): SWRResponse<AdminSlotsResponse, ApiError> {
  return useSWR<AdminSlotsResponse, ApiError>(ADMIN_SLOTS_KEY, {
    revalidateOnFocus: true,
  });
}

export function useAdminSettings(): SWRResponse<AdminSettings, ApiError> {
  return useSWR<AdminSettings, ApiError>(ADMIN_SETTINGS_KEY, {
    revalidateOnFocus: true,
  });
}
