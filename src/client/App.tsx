import { Suspense, lazy, type ReactNode } from 'react';
import { Outlet, Route, Routes } from 'react-router';
import { CustomerPage } from './components/CustomerPage';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { Skeleton } from './components/Skeleton';
import { copy } from './copy';
import { CartProvider } from './features/customer/cart/CartProvider';
import { MenuPage } from './features/customer/menu/MenuPage';
import { loadCheckoutPage, loadOrderPage, loadTrackPage } from './lazy-routes';
import { NotFound } from './NotFound';

// The admin app is its own chunk: customers never download it.
const AdminRoutes = lazy(() => import('./features/admin/AdminRoutes'));

// Customers get the menu first; checkout, the order page and the track page load on demand (and
// are prefetched once the customer is likely to need them, see `lazy-routes.ts`).
const CheckoutPage = lazy(() => loadCheckoutPage().then((m) => ({ default: m.CheckoutPage })));
const OrderPage = lazy(() => loadOrderPage().then((m) => ({ default: m.OrderPage })));
const TrackPage = lazy(() => loadTrackPage().then((m) => ({ default: m.TrackPage })));

function AdminFallback() {
  return (
    <div className="mx-auto flex max-w-120 flex-col gap-4 p-4" aria-busy="true">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

/** What a lazy customer route shows while its chunk downloads: the page chrome, never a blank screen. */
function RouteFallback() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <p role="status" className="sr-only">
        {copy.common.loading}
      </p>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

/** A lazy customer route inside the shared header and column. */
function CustomerRoute({ children }: { children: ReactNode }) {
  return (
    <CustomerPage>
      <Suspense fallback={<RouteFallback />}>
        <RouteErrorBoundary>{children}</RouteErrorBoundary>
      </Suspense>
    </CustomerPage>
  );
}

export function App() {
  return (
    <Routes>
      <Route
        element={
          <CartProvider>
            <Outlet />
          </CartProvider>
        }
      >
        <Route path="/" element={<MenuPage />} />
        <Route
          path="/checkout"
          element={
            // CheckoutPage draws its own header; the fallback keeps the brand one until it arrives.
            <Suspense
              fallback={
                <CustomerPage>
                  <RouteFallback />
                </CustomerPage>
              }
            >
              <RouteErrorBoundary withChrome>
                <CheckoutPage />
              </RouteErrorBoundary>
            </Suspense>
          }
        />
        <Route
          path="/order/:orderNumber"
          element={
            <CustomerRoute>
              <OrderPage />
            </CustomerRoute>
          }
        />
        <Route
          path="/track"
          element={
            <CustomerRoute>
              <TrackPage />
            </CustomerRoute>
          }
        />
        <Route
          path="*"
          element={
            <CustomerPage>
              <NotFound />
            </CustomerPage>
          }
        />
      </Route>
      <Route
        path="/admin/*"
        element={
          <Suspense fallback={<AdminFallback />}>
            <AdminRoutes />
          </Suspense>
        }
      />
    </Routes>
  );
}
