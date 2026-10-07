import { formatBusinessDate } from '@shared/time.js';
import { useState } from 'react';
import { Link } from 'react-router';
import { copy } from '../../../copy';
import { readRecentOrders } from './recent-orders-storage';

const t = copy.customer.track;

/** The orders placed or looked up on this phone, newest first. Nothing at all when there are none. */
export function RecentOrders() {
  const [orders] = useState(readRecentOrders);
  if (orders.length === 0) return null;
  return (
    <section aria-labelledby="recent-orders" className="mt-8">
      <h2 id="recent-orders" className="display text-lg">
        {t.recentHeading}
      </h2>
      <ul className="mt-1 flex flex-col">
        {orders.map((entry) => (
          <li key={entry.orderNumber} className="border-b border-line last:border-b-0">
            <Link
              to={`/order/${entry.orderNumber}`}
              className="flex min-h-12 items-center font-semibold text-brand underline underline-offset-2"
            >
              {t.recentItem(entry.orderNumber, formatBusinessDate(entry.deliveryDate))}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
