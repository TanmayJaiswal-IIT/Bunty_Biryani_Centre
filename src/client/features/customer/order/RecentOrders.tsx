import { formatBusinessDate } from '@shared/time.js';
import { Link } from 'react-router';
import { copy } from '../../../copy';
import { readRecentOrders } from './recent-orders-storage';

export function RecentOrders() {
  const recentOrders = readRecentOrders();

  if (recentOrders.length === 0) {
    return null;
  }

  return (
    <section className="rounded-card border border-neutral-200 bg-white p-4 shadow-xs">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-neutral-500">
        {copy.customer.track.recentOrdersHeading}
      </h2>
      <ul className="divide-y divide-neutral-100">
        {recentOrders.map((ro) => (
          <li key={ro.orderNumber}>
            <Link
              to={`/order/${ro.orderNumber}`}
              state={{ phone: ro.phone }}
              className="flex items-center justify-between py-2.5 text-sm font-medium text-neutral-900 hover:text-brand"
            >
              <span className="font-semibold">{ro.orderNumber}</span>
              <span className="text-xs text-neutral-500">{formatBusinessDate(ro.deliveryDate)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
