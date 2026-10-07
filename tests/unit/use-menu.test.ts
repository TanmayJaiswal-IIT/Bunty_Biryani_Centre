import { describe, expect, it } from 'vitest';
import { menuSwrOptions } from '../../src/client/features/customer/menu/use-menu';

describe('menuSwrOptions', () => {
  it("has no onSuccess key without a callback (undefined would override SWR's default noop)", () => {
    const options = menuSwrOptions();
    expect('onSuccess' in options).toBe(false);
    expect(options).toMatchObject({
      refreshInterval: 60_000,
      revalidateOnFocus: true,
      dedupingInterval: 5_000,
      keepPreviousData: true,
    });
  });

  it('passes the callback through as onSuccess', () => {
    const onFresh = () => undefined;
    expect(menuSwrOptions(onFresh).onSuccess).toBe(onFresh);
  });

  it('reconciliation off (checkout with a frozen request): no onSuccess key; on: the callback', () => {
    const reconcileCart = () => undefined;
    const off = menuSwrOptions(reconcileCart, { reconcile: false });
    expect('onSuccess' in off).toBe(false);
    // Only the reconcile goes; the refresh and the rest stay, so prices and stock keep updating.
    expect(off).toEqual(menuSwrOptions());
    expect(menuSwrOptions(reconcileCart, { reconcile: true }).onSuccess).toBe(reconcileCart);
    expect(menuSwrOptions(reconcileCart, {}).onSuccess).toBe(reconcileCart);
  });
});
