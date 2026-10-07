import type { PublicOrderView } from '@shared/api-types.js';
import { useMemo } from 'react';
import useSWR, { type SWRConfiguration, type SWRResponse } from 'swr';
import { api, type ApiError } from '../../../lib/api';

/** `POST /api/orders/lookup`: the order if the ID and mobile number match, else a 404. */
export function lookupOrder(input: {
  orderNumber: string;
  phone: string;
}): Promise<PublicOrderView> {
  return api<PublicOrderView>('/api/orders/lookup', { method: 'POST', body: input });
}

/**
 * `shouldRetryOnError` is off on purpose (Batch 5 Decision 11): SWR's default error retry would
 * turn one 404 into several failed lookups and use up the IP's failed-lookup allowance. The order
 * refreshes on focus, and every 60 s while the vendor hasn't acted on it.
 *
 * SWR hands `refreshInterval` the cache entry, and `fallbackData` is never written to the cache, so
 * an order that came from router state must be read from `fallback` until the first fetch lands.
 * Without that the poll would never start on that path.
 */
export function orderLookupSwrOptions(
  fallback: PublicOrderView | undefined,
): SWRConfiguration<PublicOrderView, ApiError> {
  return {
    fallbackData: fallback,
    // Always check on mount: history state survives reloads and tab restores, so the order it
    // holds may be out of date (a cancelled order must not keep saying "ORDER PLACED"). The state
    // is still the `fallbackData`, so the page renders at once with no loading flash.
    revalidateOnMount: true,
    refreshInterval: (latest) => ((latest ?? fallback)?.status === 'ORDER_RECEIVED' ? 60_000 : 0),
    revalidateOnFocus: true,
    keepPreviousData: true,
    shouldRetryOnError: false,
  };
}

/** No phone, no request: the page shows the track form instead. */
export function useOrderLookup(
  orderNumber: string,
  phone: string | null,
  fallback?: PublicOrderView,
): SWRResponse<PublicOrderView, ApiError> {
  // A new options object (and a new interval function) on every render would make SWR restart its
  // countdown, so the poll could be pushed back forever by unrelated re-renders.
  const options = useMemo(() => orderLookupSwrOptions(fallback), [fallback]);
  return useSWR<PublicOrderView, ApiError, readonly [string, string, string] | null>(
    phone ? ['/api/orders/lookup', orderNumber, phone] : null,
    ([, n, p]) => lookupOrder({ orderNumber: n, phone: p }),
    options,
  );
}
