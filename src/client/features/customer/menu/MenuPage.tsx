import { formatBusinessDate } from '@shared/time.js';
import { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router';
import { Banner } from '../../../components/Banner';
import { CustomerPage } from '../../../components/CustomerPage';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { Skeleton } from '../../../components/Skeleton';
import { copy } from '../../../copy';
import { prefetchCheckout } from '../../../lazy-routes';
import { isCartEmptyState } from '../cart/cart-empty';
import { cartView } from '../cart/cart-reducer';
import { CartBar } from '../cart/CartBar';
import { CartNotices } from '../cart/CartNotices';
import { useCart } from '../cart/CartProvider';
import { useDeliveryOptions } from '../checkout/use-delivery-options';
import { DeliverySummaryLine } from './DeliverySummaryLine';
import { ItemCard } from './ItemCard';
import { SoldOutList } from './SoldOutList';
import { useMenu } from './use-menu';

const m = copy.customer.menu;

function MenuSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {/* The skeleton blocks are aria-hidden; screen readers hear this instead. */}
      <p role="status" className="sr-only">
        {copy.common.loading}
      </p>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-card bg-surface p-3 shadow-card">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-3 ml-auto h-12 w-24" />
        </div>
      ))}
    </div>
  );
}

export function MenuPage() {
  const { cart, notices, add, increment, decrement, dismissNotices } = useCart();
  // Reconciles the cart on every successful fetch (see useMenu).
  const { data, error, isValidating, mutate } = useMenu();
  // Never awaited: the summary appears when it arrives and stays hidden on error. Mounting it
  // here also warms the cache for checkout (§8).
  const delivery = useDeliveryOptions(60_000);
  const location = useLocation();

  const quantities = useMemo(
    () => new Map(cart.lines.map((line) => [line.menuItemId, line.quantity])),
    [cart],
  );
  const view = useMemo(() => (data ? cartView(data, cart) : null), [data, cart]);

  useEffect(() => {
    if (cart.lines.length > 0) {
      prefetchCheckout();
    }
  }, [cart.lines.length]);

  if (!data || !view) {
    return (
      <CustomerPage>
        {error ? (
          <ErrorState
            title={m.loadErrorTitle}
            message={m.loadErrorMessage}
            onRetry={() => void mutate()}
            retrying={isValidating}
          />
        ) : (
          <MenuSkeleton />
        )}
      </CustomerPage>
    );
  }

  const aboveMenu = (
    <>
      {delivery.data ? <DeliverySummaryLine options={delivery.data} /> : null}
      {isCartEmptyState(location.state) && cart.lines.length === 0 ? (
        <Banner tone="info" className="mb-3">
          {copy.customer.checkout.cartEmpty}
        </Banner>
      ) : null}
    </>
  );
  const subline = m.subline(formatBusinessDate(data.businessDate));
  const pausedBanner = data.ordersPaused ? (
    <Banner tone="warning" className="mb-3">
      {m.paused}
    </Banner>
  ) : null;

  if (data.items.length === 0) {
    return (
      <CustomerPage subline={subline}>
        {aboveMenu}
        {pausedBanner}
        <CartNotices notices={notices} onDismiss={dismissNotices} />
        <EmptyState title={m.emptyTitle} message={m.emptyMessage} icon="clock" />
      </CustomerPage>
    );
  }

  const orderable = data.items.filter((item) => !item.soldOut);
  const soldOut = data.items.filter((item) => item.soldOut);

  return (
    <CustomerPage subline={subline} reserveCartBar>
      {aboveMenu}
      <h2 className="sr-only">{m.title}</h2>
      {pausedBanner}
      <CartNotices notices={notices} onDismiss={dismissNotices} />
      {orderable.length === 0 ? (
        <Banner tone="info" className="mb-3">
          {m.allSoldOut}
        </Banner>
      ) : null}
      {orderable.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {orderable.map((item) => (
            <li key={item.id}>
              <ItemCard
                item={item}
                quantity={quantities.get(item.id) ?? 0}
                onAdd={() => {
                  add(item, data.businessDate);
                }}
                onIncrement={() => {
                  increment(item);
                }}
                onDecrement={() => {
                  decrement(item.id);
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <SoldOutList items={soldOut} />
      <footer className="mt-8 mb-4 text-center">
        <Link
          to="/track"
          className="text-xs font-semibold text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          {copy.customer.order.trackOrder}
        </Link>
      </footer>
      <CartBar count={view.count} subtotal={view.subtotal} paused={data.ordersPaused} />
    </CustomerPage>
  );
}
