import type { PublicOrderView } from '@shared/api-types.js';
import { useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router';
import { AppHeader } from '../../../components/AppHeader';
import { BackToMenuLink } from '../../../components/BackToMenuLink';
import { CustomerPage } from '../../../components/CustomerPage';
import { Skeleton } from '../../../components/Skeleton';
import { copy } from '../../../copy';
import { useMenu } from '../menu/use-menu';
import { OrderDetails } from './OrderDetails';
import { parseOrderRouterState } from './order-state';
import { getRecentOrderPhone } from './recent-orders-storage';
import { TrackForm } from './TrackPage';
import { useOrderLookup } from './use-order-lookup';

export function OrderPage() {
  const { orderNumber: rawOrderNumber } = useParams<{ orderNumber: string }>();
  const orderNumber = (rawOrderNumber || '').trim().toUpperCase();
  const location = useLocation();

  // 1. Router state fallback
  const routerState = useMemo(
    () => parseOrderRouterState(location.state, orderNumber),
    [location.state, orderNumber],
  );

  // 2. Saved phone in recent orders or manual lookup state
  const [manualPhone, setManualPhone] = useState<string | null>(null);
  const [manualOrder, setManualOrder] = useState<PublicOrderView | null>(null);

  const phone = routerState?.phone || manualPhone || getRecentOrderPhone(orderNumber);

  // Prefetch menu to get businessDate for "Today" and fast "Order more"
  const { data: menu } = useMenu();

  const fallbackData = manualOrder || routerState?.order;

  // 3. Look up order
  const { data, error, isLoading } = useOrderLookup({
    orderNumber: phone ? orderNumber : null,
    phone: phone || null,
    fallbackData,
  });

  const activeOrder = data || fallbackData;

  const handleTrackSuccess = (foundOrder: PublicOrderView, lookupPhone: string) => {
    setManualPhone(lookupPhone);
    setManualOrder(foundOrder);
  };

  return (
    <CustomerPage>
      <AppHeader />
      <div className="mx-auto flex max-w-120 flex-col gap-6 p-4">
        <div>
          <BackToMenuLink />
        </div>

        {activeOrder ? (
          <OrderDetails
            order={activeOrder}
            placed={routerState?.placed}
            businessDate={menu?.businessDate}
          />
        ) : !phone || (error && error.status === 404) ? (
          <div className="flex flex-col gap-4">
            <div className="text-center">
              <h1 className="text-lg font-bold text-neutral-900">
                {copy.customer.track.heading}
              </h1>
              <p className="mt-1 text-sm text-neutral-600">{copy.customer.track.subline}</p>
            </div>
            <section className="rounded-card border border-neutral-200 bg-white p-4 shadow-xs">
              <TrackForm initialOrderNumber={orderNumber} onSuccess={handleTrackSuccess} />
            </section>
          </div>
        ) : isLoading ? (
          <div className="flex flex-col gap-4" aria-busy="true">
            <Skeleton className="h-10 w-3/4 mx-auto" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <section className="rounded-card border border-neutral-200 bg-white p-4 shadow-xs">
              <TrackForm initialOrderNumber={orderNumber} onSuccess={handleTrackSuccess} />
            </section>
          </div>
        )}
      </div>
    </CustomerPage>
  );
}

export default OrderPage;
