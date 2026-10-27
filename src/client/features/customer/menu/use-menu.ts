import type { PublicMenu } from '@shared/api-types.js';
import useSWR, { type SWRConfiguration, type SWRResponse } from 'swr';
import type { ApiError } from '../../../lib/api';
import { useCart } from '../cart/CartProvider';

export const MENU_KEY = '/api/menu';

/**
 * SWR merges configs by object spread, so an `onSuccess: undefined` key would override SWR's
 * default no-op and make every successful fetch throw. Only set `onSuccess` when there is one.
 */
export function menuSwrOptions(
  onFresh?: (menu: PublicMenu) => void,
): SWRConfiguration<PublicMenu, ApiError> {
  return {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    dedupingInterval: 5_000,
    keepPreviousData: true,
    ...(onFresh ? { onSuccess: onFresh } : {}),
  };
}

/**
 * Today's menu from the server; must run under `CartProvider`. Every successful fetch reconciles
 * the cart (§5.4) through SWR's `onSuccess`, which fires only for the hook instance that started
 * the request. Dedupe means one instance starts each request, so a fetch reconciles exactly once
 * however many components call this hook. Reconcile is idempotent for a given menu and never
 * changes the menu, so a second instance cannot cause a loop or double notices.
 */
export interface UseMenuOptions {
  reconcile?: boolean;
}

export function useMenu(options: UseMenuOptions = {}): SWRResponse<PublicMenu, ApiError> {
  const { reconcile } = useCart();
  const shouldReconcile = options.reconcile !== false;
  return useSWR<PublicMenu, ApiError>(
    MENU_KEY,
    menuSwrOptions(shouldReconcile ? reconcile : undefined),
  );
}
