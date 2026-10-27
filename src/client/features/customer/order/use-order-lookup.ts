import type { PublicOrderView } from '@shared/api-types.js';
import { useMemo } from 'react';
import useSWR, { type SWRConfiguration, type SWRResponse } from 'swr';
import { api, type ApiError } from '../../../lib/api';

export function orderLookupFetcher([path, orderNumber, phone]: readonly [
  string,
  string,
  string,
]): Promise<PublicOrderView> {
  return api<PublicOrderView>(path, {
    method: 'POST',
    body: { orderNumber, phone },
  });
}

export interface UseOrderLookupOptions {
  orderNumber?: string | null;
  phone?: string | null;
  fallbackData?: PublicOrderView;
}

export function useOrderLookup({
  orderNumber,
  phone,
  fallbackData,
}: UseOrderLookupOptions): SWRResponse<PublicOrderView, ApiError> {
  const cleanOrderNumber = orderNumber?.trim();
  const cleanPhone = phone?.trim();

  const key =
    cleanOrderNumber && cleanPhone
      ? (['/api/orders/lookup', cleanOrderNumber, cleanPhone] as const)
      : null;

  // Status to decide polling: fallbackData status if cache is unpopulated
  const activeStatus = fallbackData?.status;

  const swrConfig = useMemo<SWRConfiguration<PublicOrderView, ApiError>>(() => {
    const isReceived = activeStatus === 'ORDER_RECEIVED';
    return {
      fallbackData,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
      refreshInterval: isReceived ? 60_000 : 0,
      dedupingInterval: 5_000,
    };
  }, [fallbackData, activeStatus]);

  const response = useSWR<PublicOrderView, ApiError, readonly [string, string, string] | null>(
    key,
    orderLookupFetcher,
    swrConfig,
  );

  return response;
}
