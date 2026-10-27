import type { PublicOrderView } from '@shared/api-types.js';
import { formatINR } from '@shared/money.js';
import { Link } from 'react-router';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { CopyButton } from '../../../components/CopyButton';
import { Icon } from '../../../components/Icon';
import { copy } from '../../../copy';
import { formatDeliveryWhen, formatPaymentLabel, getStatusChip } from './order-display';

export interface OrderDetailsProps {
  order: PublicOrderView;
  placed?: boolean;
  businessDate?: string | null;
}

export function OrderDetails({ order, placed, businessDate }: OrderDetailsProps) {

  const statusChip = getStatusChip(order.status);
  const deliveryWhen = formatDeliveryWhen(order, businessDate);
  const paymentLabel = formatPaymentLabel(order.paymentStatus);

  return (
    <div className="flex flex-col gap-6">
      {/* Top Banner / Heading */}
      {order.status === 'CANCELLED' && (
        <Banner tone="danger" role="alert">
          <p>{copy.customer.order.cancelledBanner(order.contactPhone)}</p>
        </Banner>
      )}

      <div className="flex flex-col items-center text-center">
        {placed ? (
          <>
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success">
              <Icon name="check" className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              {copy.customer.order.placedHeading}
            </h1>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              {copy.customer.order.orderHeading(order.orderNumber)}
            </h1>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                statusChip.tone === 'success'
                  ? 'bg-success-soft text-success'
                  : statusChip.tone === 'danger'
                    ? 'bg-danger-soft text-danger'
                    : 'bg-info-soft text-info'
              }`}
            >
              {statusChip.label}
            </span>
          </div>
        )}

        <div className="mt-4 flex flex-col items-center gap-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {copy.customer.order.orderIdLabel}
          </span>
          <div className="flex items-center gap-2">
            <span
              id="order-id-display"
              className="font-display text-4xl font-extrabold tracking-widest text-neutral-950 select-all"
            >
              {order.orderNumber}
            </span>
            <CopyButton
              text={order.orderNumber}
              label={copy.customer.order.copy}
              copiedLabel={copy.customer.order.copied}
              ariaLabel={copy.customer.order.copy}
            />
          </div>
          <span className="text-xs text-neutral-500">{copy.customer.order.keepIdHint}</span>
        </div>
      </div>

      {/* DELIVERY Section */}
      <section className="rounded-card border border-neutral-200 bg-white p-4 shadow-xs">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-neutral-500">
          {copy.customer.order.deliveryHeading}
        </h2>
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-semibold text-neutral-900">
            {order.deliveryMode === 'BATCH'
              ? copy.customer.order.batchMode(order.locationName)
              : copy.customer.order.expressMode(order.locationName)}
          </p>
          <p className="text-neutral-700">{deliveryWhen}</p>
          {order.addressDetail && (
            <p className="text-neutral-600">{order.addressDetail}</p>
          )}
        </div>
      </section>

      {/* YOUR ORDER Section */}
      <section className="rounded-card border border-neutral-200 bg-white p-4 shadow-xs">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-neutral-500">
          {copy.customer.order.yourOrderHeading}
        </h2>
        <div className="divide-y divide-neutral-100">
          {order.items.map((item, index) => (
            <div key={`${item.name}-${index}`} className="flex items-center justify-between py-2 text-sm">
              <span className="text-neutral-800">
                {item.name} × {item.quantity}
              </span>
              <span className="font-medium text-neutral-900">{formatINR(item.lineTotal)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between py-2 text-sm text-neutral-600">
            <span>{copy.customer.order.deliveryLabel}</span>
            <span>{order.deliveryFee === 0 ? copy.customer.order.free : formatINR(order.deliveryFee)}</span>
          </div>
          <div className="flex items-center justify-between pt-3 text-base font-bold text-neutral-950">
            <span>{copy.customer.order.totalLabel}</span>
            <span>{formatINR(order.total)}</span>
          </div>
        </div>

        <div className="mt-4 rounded-control bg-neutral-50 p-3 text-xs text-neutral-700">
          <p className="font-semibold text-neutral-900">{paymentLabel}</p>
          {order.paymentStatus === 'PENDING' && (
            <p className="mt-0.5">{copy.customer.order.payInCash(formatINR(order.total))}</p>
          )}
        </div>

        {order.contactPhone && (
          <div className="mt-4 text-center">
            <a
              href={`tel:${order.contactPhone}`}
              className="text-xs font-semibold text-brand hover:underline"
            >
              {copy.customer.order.needHelp(order.contactPhone)}
            </a>
          </div>
        )}
      </section>

      {/* Navigation Actions */}
      <div className="flex gap-3">
        <Link to="/" className="flex-1">
          <Button variant="secondary" className="w-full">
            {copy.customer.order.orderMore}
          </Button>
        </Link>
        <Link to="/track" className="flex-1">
          <Button variant="secondary" className="w-full">
            {copy.customer.order.trackOrder}
          </Button>
        </Link>
      </div>
    </div>
  );
}
