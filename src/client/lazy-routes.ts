import { lazy } from 'react';

export const CheckoutPage = lazy(
  () => import('./features/customer/checkout/CheckoutPage'),
);

export const OrderPage = lazy(
  () => import('./features/customer/order/OrderPage'),
);

export const TrackPage = lazy(
  () => import('./features/customer/order/TrackPage'),
);

export function prefetchCheckout(): void {
  void import('./features/customer/checkout/CheckoutPage');
}

export function prefetchOrder(): void {
  void import('./features/customer/order/OrderPage');
}

export function prefetchTrack(): void {
  void import('./features/customer/order/TrackPage');
}
