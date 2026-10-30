import type { Dashboard } from '@shared/api-types.js';
import { OrderRow } from '../orders/OrderRow.js';

export interface ExpressSectionProps {
  express: Dashboard['express'];
  isToday: boolean;
}

export function ExpressSection({ express, isToday }: ExpressSectionProps) {
  const activeOrders = express.orders.filter(
    (o) => o.status === 'ORDER_RECEIVED',
  );
  const completedOrders = express.orders.filter(
    (o) => o.status === 'COMPLETED',
  );

  return (
    <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-ink">
          EXPRESS · {express.activeCount} active
        </h2>
      </div>

      <div className="flex flex-col gap-3">
        {activeOrders.length === 0 ? (
          <p className="text-sm text-ink-muted">No active express orders.</p>
        ) : (
          activeOrders.map((order) => (
            <OrderRow key={order.id} order={order} isToday={isToday} />
          ))
        )}
      </div>

      {completedOrders.length > 0 && (
        <details className="mt-2 group">
          <summary className="cursor-pointer font-semibold text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand">
            Completed today ({completedOrders.length})
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {completedOrders.map((order) => (
              <OrderRow key={order.id} order={order} isToday={isToday} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
