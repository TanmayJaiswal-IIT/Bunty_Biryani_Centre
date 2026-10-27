import type { AdminOrderView } from '@shared/api-types.js';
import { formatINR } from '@shared/money.js';
import { Link } from 'react-router';
import { Chip } from '../../../components/Chip.js';
import { useNewOrders } from '../alerts/NewOrdersProvider.js';
import { OrderActions } from './OrderActions.js';
import { codLabel, expressWhen, itemsInline } from './order-display.js';

export interface OrderRowProps {
  order: AdminOrderView;
  isToday?: boolean;
}

export function OrderRow({ order, isToday = true }: OrderRowProps) {
  const { isFresh, dismiss } = useNewOrders();
  const fresh = isFresh(order.id);
  const isCompleted = order.status === 'COMPLETED';
  const isCancelled = order.status === 'CANCELLED';

  const rowBg = fresh ? 'bg-gold-soft' : 'bg-surface';
  const textMuted = isCompleted ? 'text-ink-muted' : 'text-ink';

  return (
    <article
      onClick={() => {
        if (fresh) dismiss(order.id);
      }}
      className={`rounded-card border border-line p-4 transition-colors ${rowBg} ${textMuted}`}
    >
      <div className="flex flex-col gap-2">
        {/* Top header: Order Number, Chips, Total */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/admin/orders/${order.id}`}
              className="text-base font-bold text-ink hover:underline"
            >
              {order.orderNumber}
            </Link>

            {order.isLate && <Chip tone="danger">LATE</Chip>}
            {fresh && <Chip tone="gold">NEW</Chip>}

            <Chip
              tone={order.paymentStatus === 'COLLECTED' ? 'success' : 'warning'}
            >
              {codLabel(order)}
            </Chip>

            {isCompleted && <Chip tone="neutral">Completed</Chip>}
            {isCancelled && <Chip tone="danger">Cancelled</Chip>}
          </div>

          <div className="text-base font-bold text-ink">
            {formatINR(order.total)}
          </div>
        </div>

        {/* Customer & Item details */}
        <div className="text-sm">
          <span className="font-semibold">{order.customerName}</span>
          <span className="text-ink-muted"> · {order.customerPhone}</span>
        </div>

        <div className="text-sm text-ink">{itemsInline(order)}</div>

        {order.deliveryMode === 'EXPRESS' && (
          <div className="text-xs text-ink-muted">{expressWhen(order)}</div>
        )}

        {/* Actions */}
        <div className="mt-2 pt-2 border-t border-line/60">
          <OrderActions order={order} isToday={isToday} />
        </div>
      </div>
    </article>
  );
}
