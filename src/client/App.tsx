import { Suspense, lazy } from 'react';
import { Outlet, Route, Routes } from 'react-router';
import { CustomerPage } from './components/CustomerPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OfflineBanner } from './components/OfflineBanner';
import { RouteAnnouncer } from './components/RouteAnnouncer';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { Skeleton } from './components/Skeleton';
import { CartProvider } from './features/customer/cart/CartProvider';
import { MenuPage } from './features/customer/menu/MenuPage';
import { CheckoutPage, OrderPage, TrackPage } from './lazy-routes';
import { NotFound } from './NotFound';

// The admin app is its own chunk: customers never download it.
const AdminRoutes = lazy(() => import('./features/admin/AdminRoutes'));

function AdminFallback() {
  return (
    <div className="mx-auto flex max-w-120 flex-col gap-4 p-4" aria-busy="true">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function RouteFallback() {
  return (
    <CustomerPage>
      <div className="mx-auto flex max-w-120 flex-col gap-4 p-4" aria-busy="true">
        <Skeleton className="mx-auto h-10 w-3/4" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </CustomerPage>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <OfflineBanner />
      <RouteAnnouncer />
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
            <RouteErrorBoundary>
              <Suspense fallback={<RouteFallback />}>
                <CheckoutPage />
              </Suspense>
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/order/:orderNumber"
          element={
            <RouteErrorBoundary>
              <Suspense fallback={<RouteFallback />}>
                <OrderPage />
              </Suspense>
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/track"
          element={
            <RouteErrorBoundary>
              <Suspense fallback={<RouteFallback />}>
                <TrackPage />
              </Suspense>
            </RouteErrorBoundary>
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
          <RouteErrorBoundary withChrome={false}>
            <Suspense fallback={<AdminFallback />}>
              <AdminRoutes />
            </Suspense>
          </RouteErrorBoundary>
        }
      />
    </Routes>
    </ErrorBoundary>
  );
}
