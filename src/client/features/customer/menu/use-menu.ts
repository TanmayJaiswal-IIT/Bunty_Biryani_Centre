import type { PublicMenu } from '@shared/api-types.js';
import useSWR, { type SWRConfiguration, type SWRResponse } from 'swr';
import type { ApiError } from '../../../lib/api';
import { useCart } from '../cart/CartProvider';

export const MENU_KEY = '/api/menu';

export interface UseMenuOptions {
  /**
   * Reconcile the cart on each successful fetch (§5.4); on by default. Checkout turns it off while
   * a request is frozen (Batch 5 §7.2): the customer's own unconfirmed order may have sold out the
   * cart, and reconciling would empty it, leave checkout and lose "Try again".
   */
  reconcile?: boolean;
}

/**
 * `onSuccess` is `onFresh` (the cart's reconcile) while reconciliation is on, and is left out when
 * it is off. SWR merges configs by object spread, so an `onSuccess: undefined` key would override
 * SWR's default no-op and make every successful fetch throw. Only set `onSuccess` when there is one.
 */
export function menuSwrOptions(
  onFresh?: (menu: PublicMenu) => void,
  { reconcile = true }: UseMenuOptions = {},
): SWRConfiguration<PublicMenu, ApiError> {
  const onSuccess = reconcile ? onFresh : undefined;
  return {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    dedupingInterval: 5_000,
    keepPreviousData: true,
    ...(onSuccess ? { onSuccess } : {}),
  };
}

/**
 * Today's menu from the server; must run under `CartProvider`. Every successful fetch reconciles
 * the cart (§5.4) through SWR's `onSuccess`, unless `reconcile: false`; it fires only for the hook
 * instance that started the request. Dedupe means one instance starts each request, so a fetch
 * reconciles exactly once however many components call this hook. Reconcile is idempotent for a
 * given menu and never changes the menu, so a second instance cannot cause a loop or double
 * notices. SWR reads `onSuccess` from the latest options when a request resolves, so turning
 * reconciliation off or on applies from the next fetch that resolves.
 */
export function useMenu(options: UseMenuOptions = {}): SWRResponse<PublicMenu, ApiError> {
  const { reconcile } = useCart();
  return useSWR<PublicMenu, ApiError>(MENU_KEY, menuSwrOptions(reconcile, options));
}
