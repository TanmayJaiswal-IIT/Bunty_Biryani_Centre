import { orderNumberSchema } from '@shared/schemas/order.js';
import { useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router';
import { ErrorState } from '../../../components/ErrorState';
import { Skeleton } from '../../../components/Skeleton';
import { copy } from '../../../copy';
import type { ApiError } from '../../../lib/api';
import { useMenu } from '../menu/use-menu';
import { OrderDetails } from './OrderDetails';
import { parseOrderState } from './order-state';
import { phoneForOrder } from './recent-orders-storage';
import { TrackForm } from './TrackPage';
import { useOrderLookup } from './use-order-lookup';

const o = copy.customer.order;

function OrderSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col items-center gap-4">
      <p role="status" className="sr-only">
        {copy.common.loading}
      </p>
      <Skeleton className="size-12 rounded-full" />
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-12 w-56" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function TrackFallback({ orderNumber, notFound }: { orderNumber?: string; notFound?: boolean }) {
  return (
    <>
      <h2 className="display mb-4 text-2xl">{copy.customer.track.title}</h2>
      <TrackForm
        {...(orderNumber ? { initialOrderNumber: orderNumber } : {})}
        notFound={notFound}
      />
    </>
  );
}

function failureMessage(error: ApiError): string {
  if (error.status === 429) return copy.customer.track.rateLimited;
  if (error.code === 'NETWORK_ERROR') return copy.common.networkError;
  return copy.common.genericError;
}

interface OrderLoaderProps {
  orderNumber: string;
  routeState: unknown;
  businessDate: string | null;
}

/**
 * Where the order comes from (Batch 5 §8.1): the router state of the submit, else the phone saved
 * for this order on this device, else the track form with the ID filled in.
 */
function OrderLoader({ orderNumber, routeState, businessDate }: OrderLoaderProps) {
  // Memoised: the parse builds a new object each time, and the lookup options are keyed on it.
  const fromState = useMemo(
    () => parseOrderState(routeState, orderNumber),
    [routeState, orderNumber],
  );
  const [storedPhone] = useState(() => phoneForOrder(orderNumber));
  const phone = fromState?.phone ?? storedPhone;
  const { data, error, isValidating, mutate } = useOrderLookup(
    orderNumber,
    phone,
    fromState?.order,
  );

  if (!phone) return <TrackFallback orderNumber={orderNumber} />;
  if (data) {
    return (
      <OrderDetails order={data} placed={fromState?.placed ?? false} businessDate={businessDate} />
    );
  }
  if (error) {
    if (error.status === 404) return <TrackFallback orderNumber={orderNumber} notFound />;
    return (
      <ErrorState
        title={o.loadError}
        message={failureMessage(error)}
        onRetry={() => void mutate()}
        retrying={isValidating}
      />
    );
  }
  return <OrderSkeleton />;
}

/** `/order/:orderNumber`: the confirmation after placing an order, and its status afterwards. */
export function OrderPage() {
  const { orderNumber: param = '' } = useParams();
  const routeState: unknown = useLocation().state;
  // "Today" for the delivery line; also warms the menu for "Order more".
  const { data: menu } = useMenu();
  const parsed = orderNumberSchema.safeParse(param);
  if (!parsed.success) return <TrackFallback />;
  return (
    <OrderLoader
      key={parsed.data}
      orderNumber={parsed.data}
      routeState={routeState}
      businessDate={menu?.businessDate ?? null}
    />
  );
}
