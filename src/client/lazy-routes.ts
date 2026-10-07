// The customer routes that aren't needed on first load are separate chunks, so the menu (`/`)
// stays inside its first-load budget (Batch 1 §10.5). The same `import()` serves the lazy route
// and the prefetch, so a tap never waits on a download that could have started earlier.

export const loadCheckoutPage = () => import('./features/customer/checkout/CheckoutPage');
export const loadOrderPage = () => import('./features/customer/order/OrderPage');
export const loadTrackPage = () => import('./features/customer/order/TrackPage');

/** Starts a download in the background. A failure is harmless: the route retries when it is opened. */
export function prefetch(load: () => Promise<unknown>): void {
  load().catch(() => undefined);
}
