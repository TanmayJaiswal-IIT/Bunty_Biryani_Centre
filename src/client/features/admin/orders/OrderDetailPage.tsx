import { formatINR } from '@shared/money.js';
import { formatTime12h, formatWindow } from '@shared/time.js';
import { Link, useParams } from 'react-router';
import { Button } from '../../../components/Button.js';
import { Chip } from '../../../components/Chip.js';
import { CopyButton } from '../../../components/CopyButton.js';
import { EmptyState } from '../../../components/EmptyState.js';
import { ErrorState } from '../../../components/ErrorState.js';
import { copy } from '../../../copy.js';
import { useAdminOrder } from '../api/hooks.js';
import { OrderActions } from './OrderActions.js';
import { codLabel, formatInstant } from './order-display.js';

export function OrderDetailPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);
  const isValidId = Number.isInteger(id) && id > 0;

  const { data: order, error, isLoading, mutate } = useAdminOrder(
    isValidId ? id : null,
  );

  if (!isValidId || (error && error.status === 404)) {
    return (
      <EmptyState
        title={copy.admin.notFoundTitle}
        message={copy.admin.notFoundMessage}
        icon="alert"
        action={
          <Link to="/admin/orders">
            <Button variant="secondary">{copy.admin.backToToday}</Button>
          </Link>
        }
      />
    );
  }

  if (isLoading && !order) {
    return (
      <div className="flex flex-col gap-4 p-4 animate-pulse">
        <div className="h-10 rounded-card bg-neutral-200" />
        <div className="h-40 rounded-card bg-neutral-200" />
        <div className="h-40 rounded-card bg-neutral-200" />
      </div>
    );
  }

  if (error && !order) {
    return (
      <ErrorState
        title="Couldn't load order"
        message={error.message}
        onRetry={() => void mutate()}
      />
    );
  }

  if (!order) return null;

  return (
    <div className="flex flex-col gap-4 p-4 max-w-2xl mx-auto">
      {/* Top nav */}
      <div className="flex items-center justify-between">
        <Link
          to="/admin/orders"
          className="text-sm font-semibold text-brand hover:underline"
        >
          ← Back to orders
        </Link>
      </div>

      {/* Header: Order Number, Chips, Total */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-surface p-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold font-display uppercase tracking-wide text-ink">
              {order.orderNumber}
            </h1>

            {order.isLate && <Chip tone="danger">LATE</Chip>}

            <Chip
              tone={order.paymentStatus === 'COLLECTED' ? 'success' : 'warning'}
            >
              {codLabel(order)}
            </Chip>

            {order.status === 'COMPLETED' && (
              <Chip tone="neutral">Completed</Chip>
            )}
            {order.status === 'CANCELLED' && (
              <Chip tone="danger">Cancelled</Chip>
            )}
            {order.status === 'ORDER_RECEIVED' && (
              <Chip tone="info">Order received</Chip>
            )}
          </div>

          <div className="text-sm text-ink-muted">
            Placed at {formatInstant(order.createdAt)}
          </div>
        </div>

        <div className="text-xl font-bold text-ink">
          {formatINR(order.total)}
        </div>
      </div>

      {/* Customer Info Card */}
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <h2 className="text-sm font-bold font-display uppercase tracking-wider text-ink-muted">
          Customer details
        </h2>
        <div className="flex flex-col gap-1 text-sm">
          <div className="font-semibold text-ink">{order.customerName}</div>
          <div className="flex items-center gap-2">
            <span className="text-ink">{order.customerPhone}</span>
            <CopyButton
              text={order.customerPhone}
              label="Copy"
              copiedLabel="Copied"
              ariaLabel="Copy phone number"
            />
            <a
              href={`tel:${order.customerPhone}`}
              className="font-semibold text-brand hover:underline"
            >
              Call
            </a>
          </div>
          <div className="text-ink-muted mt-1">{order.addressDetail}</div>
        </div>
      </div>

      {/* Delivery Info Card */}
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <h2 className="text-sm font-bold font-display uppercase tracking-wider text-ink-muted">
          Delivery information
        </h2>
        <div className="flex flex-col gap-1 text-sm">
          <div className="font-semibold text-ink">
            {order.deliveryMode === 'EXPRESS' ? 'Express delivery' : 'Batch delivery'} · {order.locationName}
          </div>

          {order.deliveryMode === 'BATCH' && order.slotDeliveryTime && (
            <div className="text-ink-muted">
              Delivery slot: {formatTime12h(order.slotDeliveryTime)}
            </div>
          )}

          {order.deliveryMode === 'EXPRESS' && order.expressWindow && (
            <div className="text-ink-muted">
              Delivery window: approx.{' '}
              {formatWindow(order.expressWindow.from, order.expressWindow.to)}
              {order.expressWindow.etaText && ` (${order.expressWindow.etaText})`}
            </div>
          )}
        </div>
      </div>

      {/* Items Card */}
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <h2 className="text-sm font-bold font-display uppercase tracking-wider text-ink-muted">
          Ordered items
        </h2>
        <div className="flex flex-col divide-y divide-line">
          {order.items.map((item) => (
            <div
              key={item.menuItemId}
              className="flex items-center justify-between py-2 text-sm"
            >
              <div>
                <span className="font-semibold text-ink">{item.name}</span>
                <span className="text-ink-muted"> × {item.quantity}</span>
              </div>
              <div className="font-medium text-ink">
                {formatINR(item.lineTotal)}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-2 flex flex-col gap-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between text-ink-muted">
            <span>Food subtotal</span>
            <span>{formatINR(order.foodSubtotal)}</span>
          </div>
          <div className="flex justify-between text-ink-muted">
            <span>Delivery</span>
            <span>{order.deliveryFee === 0 ? 'Free' : formatINR(order.deliveryFee)}</span>
          </div>
          <div className="flex justify-between text-base font-bold text-ink pt-1 border-t border-line/60">
            <span>Total</span>
            <span>{formatINR(order.total)}</span>
          </div>
        </div>
      </div>

      {/* Timestamps Card */}
      <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4 text-xs text-ink-muted">
        <div>Placed at {formatInstant(order.createdAt)}</div>
        {order.completedAt && (
          <div>Completed at {formatInstant(order.completedAt)}</div>
        )}
        {order.collectedAt && (
          <div>Cash collected at {formatInstant(order.collectedAt)}</div>
        )}
        {order.cancelledAt && (
          <div>Cancelled at {formatInstant(order.cancelledAt)}</div>
        )}
      </div>

      {/* Actions */}
      <div className="rounded-card border border-line bg-surface p-4">
        <OrderActions order={order} isToday={true} />
      </div>
    </div>
  );
}
